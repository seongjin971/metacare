import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { migrateCare } from '../server/migrate-care.ts';
import { createVercelCareHandler } from '../server/vercel-care.ts';
import type { CaregiverData, CaregiverSession, Invite, PatientSession, SnapshotInput } from '../shared/care-types.ts';
import { MAX_PHOTO_BYTES, PHOTO_PART_BYTES, uploadSharedPhoto, downloadSharedPhoto } from '../shared/care-photo-parts.ts';

// Deliberately do not fall back to DATABASE_URL, which may belong to a deployed service.
const testUrl = process.env.TEST_DATABASE_URL;

test('deployed API accepts only configured HTTPS web origins, even if a PC preview origin is configured', async () => {
  const allowed = ['https://patient.example', 'https://caregiver.example'];
  const development = ['http://localhost:8081', 'https://preview.localhost.', 'https://192.168.1.10',
    'https://[::1]', 'https://preview.local', 'https://intranet', 'http://patient.example', 'null', ''];
  const pool = new Pool();
  try {
    const handle = createVercelCareHandler(pool, { allowedOrigins: [...allowed, ...development] });
    const preflight = (origin?: string) => handle(new Request('https://api.example/v1/caregiver/snapshot', {
      method: 'OPTIONS', headers: origin === undefined ? {} : { origin },
    }));
    for (const origin of allowed) {
      const response = await preflight(origin);
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
    }
    for (const origin of [...development, 'https://unlisted.example']) {
      const response = await preflight(origin);
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
    assert.equal((await preflight()).status, 204);
  } finally { await pool.end(); }
});

test('Vercel handlers share durable pairing, scoped snapshots, multipart photos and rate limits', { skip: !testUrl }, async t => {
  const schema = 'care_test_' + randomBytes(10).toString('hex');
  const admin = new Pool({ connectionString: testUrl });
  await admin.query('CREATE SCHEMA ' + schema);
  const options = { connectionString: testUrl, options: '-c search_path=' + schema };
  const one = new Pool(options);
  const two = new Pool(options);
  t.after(async () => {
    await Promise.all([one.end(), two.end()]);
    await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
    await admin.end();
  });
  await Promise.all([migrateCare(one), migrateCare(two)]);
  let now = new Date('2026-11-02T01:00:00Z').getTime();
  const config = { now: () => now, allowedOrigins: ['https://patient.example'] };
  const first = createVercelCareHandler(one, config);
  const second = createVercelCareHandler(two, config);
  function api(handler: typeof first, path: string, method = 'GET', token?: string, body?: unknown, extraHeaders?: Record<string, string>) {
    return handler(new Request('https://metacare.example' + path, {
      method, headers: { 'x-vercel-forwarded-for': '192.0.2.1', ...(token && { authorization: 'Bearer ' + token }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
  }
  const health = await api(first, '/api/care?careRoute=health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.match(health.headers.get('cache-control')!, /no-store/);
  assert.equal((await api(first, '/v1/health?token=bad')).status, 400);
  assert.equal((await api(first, '/v1/patient/connection', 'GET', undefined)).status, 401);
  assert.equal((await api(first, '/v1/health', 'OPTIONS', undefined, undefined, { origin: 'https://outside.example' })).status, 403);
  const preflight = await api(first, '/v1/health', 'OPTIONS', undefined, undefined, { origin: 'https://patient.example' });
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://patient.example');

  async function account(handler: typeof first) {
    const response = await api(handler, '/v1/patients', 'POST', undefined, {});
    assert.equal(response.status, 201);
    return (await response.json() as PatientSession).token;
  }
  async function code(token: string) {
    const response = await api(first, '/v1/patient/invite', 'POST', token, {});
    assert.equal(response.status, 201);
    return (await response.json() as Invite).code;
  }
  function connect(handler: typeof first, invite: string) {
    return api(handler, '/v1/caregivers/connect', 'POST', undefined, { code: invite, caregiverName: '시연 보호자' });
  }
  const patient = await account(first);
  const invite = await code(patient);
  const concurrent = await Promise.all([connect(first, invite), connect(second, invite)]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 400]);
  const guardian = (await concurrent.find(r => r.status === 201)!.json() as CaregiverSession).token;
  const outsider = await account(second);
  const other = (await (await connect(second, await code(outsider))).json() as CaregiverSession).token;
  const connection = await api(second, '/v1/patient/connection', 'GET', patient);
  const pair = await connection.json();
  assert.equal(pair.photoTransfer, 'parts-v1');
  const snapshot: SnapshotInput = { patientName: '시연 환자', schedule: { frequency: 'once', times: ['10:00'] }, doses: [
    { id: 'dose1', label: '시연', date: '2026-11-02', time: '10:00', status: 'taken', takenAt: new Date(now).toISOString(),
      photo: { id: 'photo1', capturedAt: new Date(now).toISOString(), verified: true } },
  ] };
  const visit = { hospitalName: '시연 의원', date: '2026-11-02', time: '10:01' };
  const withVisit = { ...snapshot, nextVisit: visit, visitUpdate: { connectedAt: pair.connectedAt, enabled: true, consentRevision: 1, scheduleRevision: 1 } };
  assert.equal((await api(first, '/v1/patient/snapshot', 'PUT', patient, withVisit)).status, 200);
  // Emulate the two credential-bearing columns from the retired schema.
  await one.query('CREATE TABLE metacare_overdue_settings(push_token text, next_job jsonb)');
  await one.query("INSERT INTO metacare_overdue_settings VALUES ('retired-test-target', '{}')");
  await migrateCare(one);
  await migrateCare(two);
  assert.deepEqual((await one.query('SELECT * FROM metacare_overdue_settings')).rows, [{ push_token: null, next_job: null }]);
  await assert.rejects(one.query("UPDATE metacare_overdue_settings SET push_token = 'stale-client'"), { code: '23514' });
  assert.deepEqual(await (await api(first, '/v1/caregiver/alerts', 'GET', guardian)).json(), { enabled: false, threshold: 30 });
  assert.equal((await api(second, '/v1/caregiver/alerts', 'PUT', guardian, { enabled: true })).status, 410);
  assert.equal((await api(first, '/v1/web-push/key')).status, 404);
  const synced = await (await api(second, '/v1/caregiver/snapshot', 'GET', guardian)).json() as CaregiverData;
  assert.equal(synced.photoTransfer, 'parts-v1');
  assert.equal(synced.snapshot?.doses[0].takenAt, new Date(now).toISOString());
  assert.deepEqual(synced.snapshot?.nextVisit, visit);
  now += 60_000;
  const expired = await (await api(second, '/v1/caregiver/snapshot', 'GET', guardian)).json() as CaregiverData;
  assert.equal(expired.snapshot?.nextVisit, undefined);
  const photoPath = '/v1/caregiver/photos/photo1/parts/0';
  assert.equal((await api(first, photoPath, 'GET', other)).status, 404);
  const image = Buffer.alloc(MAX_PHOTO_BYTES, 95);
  image.set([0xff, 0xd8, 0xff]);
  const dataUri = 'data:image/jpeg;base64,' + image.toString('base64');
  const client = (handler: typeof first) => async <T>(path: string, options: { method?: string; token?: string; body?: unknown }): Promise<T> => {
    assert.ok(!options.body || Buffer.byteLength(JSON.stringify(options.body)) < 4_500_000);
    const response = await api(handler, path, options.method, options.token, options.body);
    assert.equal(response.status, 200, 'unexpected response at ' + path);
    const json = await response.text();
    assert.ok(Buffer.byteLength(json) < 4_500_000);
    return JSON.parse(json) as T;
  };
  await uploadSharedPhoto(client(first), 'photo1', patient, dataUri, 'parts-v1', () => true);
  assert.ok((await downloadSharedPhoto(client(second), 'photo1', guardian, 'parts-v1', () => true)) === dataUri, 'max-size image should round-trip intact');
  assert.equal((await api(second, photoPath, 'GET', other)).status, 404);
  const startReplacement = await api(first, '/v1/patient/photos/photo1/parts/0', 'PUT', patient, {
    mime: 'image/jpeg', bytes: image.byteLength, base64: image.subarray(0, PHOTO_PART_BYTES).toString('base64'),
  });
  assert.equal(startReplacement.status, 200);
  const { uploadId } = await startReplacement.json();
  // On Vercel an empty DELETE can arrive as a ReadableStream, even with no Content-Length.
  const disconnect = (body: Uint8Array<ArrayBuffer>, extraHeaders: Record<string, string> = {}) => second(new Request('https://metacare.example/v1/caregiver/connection', {
    method: 'DELETE', headers: { authorization: 'Bearer ' + guardian, ...extraHeaders }, body,
  }));
  assert.equal((await disconnect(new Uint8Array([1]))).status, 400);
  assert.equal((await disconnect(new Uint8Array([1]), { 'content-length': '0' })).status, 400);
  assert.equal((await disconnect(new Uint8Array(0), { 'content-length': '8000' })).status, 400);
  assert.equal((await api(first, '/v1/caregiver/snapshot', 'GET', guardian)).status, 200);
  assert.equal((await disconnect(new Uint8Array(0))).status, 200);
  assert.equal((await api(first, photoPath, 'GET', guardian)).status, 401);
  const delayed = await api(first, '/v1/patient/snapshot', 'PUT', patient, withVisit);
  assert.equal(delayed.status, 200);
  assert.equal((await delayed.json()).sharingRevoked, true);
  const retained = await two.query('SELECT count(*)::int AS count FROM metacare_patients WHERE snapshot IS NOT NULL');
  assert.equal(retained.rows[0].count, 0, 'late upload cannot restore withdrawn records');
  assert.notEqual((await api(first, '/v1/patient/photos/photo1/parts/1', 'PUT', patient, {
    uploadId, base64: image.subarray(PHOTO_PART_BYTES).toString('base64'),
  })).status, 200);
  const cleared = await two.query('SELECT (SELECT COUNT(*) FROM metacare_photo_uploads) AS staged, (SELECT COUNT(*) FROM metacare_photos) AS stored');
  assert.deepEqual(cleared.rows[0], { staged: '0', stored: '0' });
  const guesses = await Promise.all(Array.from({ length: 31 }, (_, index) => api(index % 2 ? first : second, '/v1/caregivers/connect',
    'POST', undefined, { code: '12345678', caregiverName: 'X' }, { 'x-vercel-forwarded-for': '192.0.2.5' })));
  assert.equal(guesses.filter(r => r.status === 429).length, 1);
});
