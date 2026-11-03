import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import test, { type TestContext } from 'node:test';
import { startCareServer } from '../server/care-server.ts';
import { RetryablePushError } from '../server/overdue.ts';
import type { CaregiverData, CaregiverSession, CareSnapshot, Invite, PatientConnection, PatientSession, SnapshotInput } from '../shared/care-types.ts';

const NOW = Date.parse('2026-11-01T00:00:00.000Z');
// One actual 1px PNG. Images are never fetched from the network in these tests.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

async function removeTestDirectory(directory: string): Promise<void> {
  const target = resolve(directory);
  assert.ok(target.startsWith(`${resolve(tmpdir())}${sep}`) && basename(target).startsWith('metacare-care-'));
  await rm(target, { recursive: true, force: true });
}

function snapshot(patientName = '김환자'): SnapshotInput {
  return {
    patientName,
    schedule: { frequency: 'twice', times: ['08:00', '18:00'] },
    doses: [
      { id: 'dose-2026-11-01-0800', date: '2026-11-01', time: '08:00', label: '아침약', status: 'taken', takenAt: '2026-11-01T00:00:00.000Z', photo: { id: 'photo-first', capturedAt: '2026-11-01T00:00:00.000Z', verified: true } },
      { id: 'dose-2026-11-01-1800', date: '2026-11-01', time: '18:00', label: '저녁약', status: 'pending' },
    ],
  };
}

async function fixture(t: TestContext, extra: Parameters<typeof startCareServer>[0] = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'metacare-care-'));
  const dataPath = join(directory, 'care.json');
  const options = { port: 0, host: '127.0.0.1', dataPath, now: () => NOW, ...extra };
  let running = await startCareServer(options);
  t.after(async () => { await running.close(); await removeTestDirectory(directory); });
  const api = async <T = Record<string, unknown>>(path: string, method = 'GET', token?: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`http://127.0.0.1:${running.port}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { response, body: (response.status === 204 ? {} : await response.json()) as T };
  };
  const patient = async () => {
    const result = await api<PatientSession>('/v1/patients', 'POST', undefined, {});
    assert.equal(result.response.status, 201);
    return result.body.token;
  };
  const invite = async (token: string) => {
    const result = await api<Invite>('/v1/patient/invite', 'POST', token, {});
    assert.equal(result.response.status, 201);
    assert.match(result.body.code, /^\d{8}$/);
    return result.body;
  };
  const connect = async (code: string, caregiverName = '김보호자') => api<CaregiverSession>('/v1/caregivers/connect', 'POST', undefined, { code, caregiverName });
  const pair = async (patientToken: string) => {
    const result = await connect((await invite(patientToken)).code);
    assert.equal(result.response.status, 201);
    return result.body.token;
  };
  const restart = async () => { await running.close(); running = await startCareServer(options); };
  return { api, patient, invite, connect, pair, restart, dataPath, directory, port: () => running.port,
    processAlerts: () => running.processDueAlerts() };
}

const alertsPath = '/v1/caregiver/alerts';
const enableAlerts = { enabled: true, threshold: 30, timeZone: 'Asia/Seoul', expoPushToken: 'ExpoPushToken[synthetic_local_test]' };

test('closed apps receive one overdue push per slot, including after server restart; a timely record suppresses it', async t => {
  let clock = Date.parse('2026-11-01T07:00:00+09:00');
  const pushes: string[] = [];
  const f = await fixture(t, { now: () => clock, sendOverdue: async (_token, slot) => {
    pushes.push(slot.date + ' ' + slot.time); return 'accepted';
  } });
  const p = await f.patient();
  const g = await f.pair(p);
  const shared = snapshot();
  await f.api('/v1/patient/snapshot', 'PUT', p, { ...shared, doses: [] });
  assert.equal((await f.api(alertsPath, 'PUT', p, enableAlerts)).response.status, 401);
  assert.deepEqual((await f.api(alertsPath, 'GET', g)).body, { enabled: false, threshold: 30 });
  assert.deepEqual((await f.api(alertsPath, 'PUT', g, enableAlerts)).body, { enabled: true, threshold: 30 });
  clock = Date.parse('2026-11-01T08:29:59+09:00');
  await f.processAlerts();
  assert.deepEqual(pushes, []);
  // Both apps can stop issuing requests before the deadline.
  await f.restart();
  clock += 1000;
  await Promise.all([f.processAlerts(), f.processAlerts()]);
  assert.deepEqual(pushes, ['2026-11-01 08:00']);
  // Re-enabling later with a longer delay cannot send a second alert for the same dose.
  await f.api(alertsPath, 'PUT', g, { enabled: false, threshold: 60 });
  await f.api(alertsPath, 'PUT', g, { ...enableAlerts, threshold: 60 });
  clock += 30 * 60000;
  await f.processAlerts();
  const evening = { ...shared.doses[1], status: 'taken', takenAt: '2026-11-01T09:30:00.000Z' };
  clock = Date.parse(evening.takenAt);
  assert.equal((await f.api('/v1/patient/snapshot', 'PUT', p, { ...shared, doses: [shared.doses[0], evening] })).response.status, 200);
  clock = Date.parse('2026-11-01T19:00:00+09:00');
  await f.processAlerts();
  assert.deepEqual(pushes, ['2026-11-01 08:00']);
  clock = Date.parse('2026-11-02T09:00:00+09:00');
  await f.processAlerts();
  assert.deepEqual(pushes, ['2026-11-01 08:00', '2026-11-02 08:00']);
  await f.api('/v1/patient/connection', 'DELETE', p);
  assert.ok(!(await readFile(f.dataPath, 'utf8')).includes(enableAlerts.expoPushToken));
  await f.restart();
  clock += 10 * 3600000;
  await f.processAlerts();
  assert.equal(pushes.length, 2);
  assert.equal((await f.api(alertsPath, 'GET', g)).response.status, 401);
});

test('known push refusal is rechecked before retry; uncertain provider acceptance is not repeated', async t => {
  let clock = Date.parse('2026-11-01T07:00:00+09:00');
  const attempts: string[] = [];
  const f = await fixture(t, { now: () => clock, sendOverdue: async (_token, slot) => {
    attempts.push(slot.time);
    if (slot.time === '08:00') throw new RetryablePushError('Rate limited.');
    throw new Error('Response lost.');
  } });
  const p = await f.patient();
  const g = await f.pair(p);
  const shared = snapshot();
  await f.api('/v1/patient/snapshot', 'PUT', p, { ...shared, doses: [] });
  await f.api(alertsPath, 'PUT', g, enableAlerts);
  clock = Date.parse('2026-11-01T08:30:00+09:00');
  await f.processAlerts();
  assert.deepEqual(attempts, ['08:00']);
  await f.api('/v1/patient/snapshot', 'PUT', p, shared);
  clock += 61000;
  await f.processAlerts();
  assert.deepEqual(attempts, ['08:00']);
  clock = Date.parse('2026-11-01T18:30:00+09:00');
  await f.processAlerts();
  await f.restart();
  await f.processAlerts();
  assert.deepEqual(attempts, ['08:00', '18:00']);
});

test('an elapsed deadline wakes the HTTP server timer without a poll from either device', async t => {
  let start: number | undefined;
  const due = Date.parse('2026-11-01T08:30:00+09:00');
  const received = Promise.withResolvers<string>();
  const f = await fixture(t, {
    now: () => due - 1200 + (start === undefined ? 0 : Date.now() - start),
    sendOverdue: async (_token, slot) => { received.resolve(slot.time); return 'accepted'; },
  });
  const p = await f.patient();
  const g = await f.pair(p);
  await f.api('/v1/patient/snapshot', 'PUT', p, { ...snapshot(), doses: [] });
  start = Date.now();
  assert.equal((await f.api(alertsPath, 'PUT', g, enableAlerts)).response.status, 200);
  const timeout = setTimeout(() => received.reject(new Error('Background timer did not send.')), 5000);
  try { assert.equal(await received.promise, '08:00'); } finally { clearTimeout(timeout); }
});

test('transferring a push token stops the previous family’s notifications, and revoked platform tokens are forgotten', async t => {
  let clock = Date.parse('2026-11-01T07:00:00+09:00');
  const attempts: string[] = [];
  const f = await fixture(t, { now: () => clock, sendOverdue: async (_token, slot) => {
    attempts.push(slot.time); return 'unregistered';
  } });
  const first = await f.patient();
  const second = await f.patient();
  const guardianA = await f.pair(first);
  const guardianB = await f.pair(second);
  await f.api('/v1/patient/snapshot', 'PUT', first, { ...snapshot(), schedule: { frequency: 'once', times: ['08:00'] }, doses: [] });
  await f.api('/v1/patient/snapshot', 'PUT', second, { ...snapshot(), schedule: { frequency: 'once', times: ['09:00'] }, doses: [] });
  await f.api(alertsPath, 'PUT', guardianA, enableAlerts);
  await f.api(alertsPath, 'PUT', guardianB, enableAlerts);
  assert.deepEqual((await f.api(alertsPath, 'GET', guardianA)).body, { enabled: false, threshold: 30 });
  await f.restart();
  clock = Date.parse('2026-11-01T08:30:00+09:00');
  await f.processAlerts();
  assert.deepEqual(attempts, []);
  clock += 3600000;
  await f.processAlerts();
  assert.deepEqual(attempts, ['09:00']);
  assert.deepEqual((await f.api(alertsPath, 'GET', guardianB)).body, { enabled: false, threshold: 30 });
  assert.ok(!(await readFile(f.dataPath, 'utf8')).includes(enableAlerts.expoPushToken));
});

test('care authenticates devices, isolates families, and gives caregivers read-only records', async t => {
  const f = await fixture(t);
  for (const path of ['/v1/patient/connection', '/v1/caregiver/snapshot', '/v1/caregiver/photos/photo-first']) {
    assert.equal((await f.api(path)).response.status, 401);
    assert.equal((await f.api(path, 'GET', 'x'.repeat(43))).response.status, 401);
  }
  const patientA = await f.patient();
  const patientB = await f.patient();
  assert.notEqual(patientA, patientB);
  assert.equal((await f.api('/v1/patient/snapshot', 'PUT', patientA, snapshot('가족 A'))).response.status, 200);
  assert.equal((await f.api('/v1/patient/snapshot', 'PUT', patientB, snapshot('가족 B'))).response.status, 200);
  const caregiverA = await f.pair(patientA);
  const caregiverB = await f.pair(patientB);
  const a = await f.api<CaregiverData>('/v1/caregiver/snapshot', 'GET', caregiverA);
  const b = await f.api<CaregiverData>('/v1/caregiver/snapshot', 'GET', caregiverB);
  assert.equal(a.body.snapshot?.patientName, '가족 A');
  assert.equal(b.body.snapshot?.patientName, '가족 B');
  assert.equal(a.response.headers.get('cache-control'), 'no-store');
  assert.equal((await f.api('/v1/patient/snapshot', 'PUT', caregiverA, snapshot())).response.status, 401);
  assert.equal((await f.api('/v1/patient/invite', 'POST', caregiverA, {})).response.status, 401);
  assert.equal((await f.api('/v1/caregiver/snapshot', 'PUT', caregiverA, snapshot())).response.status, 404);
  assert.equal((await f.api('/v1/caregiver/snapshot', 'GET', patientA)).response.status, 401);
  assert.equal((await f.api(`/v1/caregiver/snapshot?token=${caregiverA}`)).response.status, 400);
  const connection = await f.api<PatientConnection>('/v1/patient/connection', 'GET', patientA);
  assert.deepEqual(connection.body, { caregiverName: '김보호자', connectedAt: new Date(NOW).toISOString() });
});

test('invitations expire, replace old codes, are consumed once, and pair atomically', async t => {
  let clock = NOW;
  const f = await fixture(t, { now: () => clock });
  const patient = await f.patient();
  const old = await f.invite(patient);
  const latest = await f.invite(patient);
  assert.notEqual(old.code, latest.code);
  const used = await f.connect(old.code);
  assert.equal(used.response.status, 400);
  clock += 10 * 60 * 1000;
  const expired = await f.connect(latest.code);
  assert.equal(expired.response.status, 400);
  assert.deepEqual(expired.body, used.body);
  const fresh = await f.invite(patient);
  const results = await Promise.all([f.connect(fresh.code, '첫 보호자'), f.connect(fresh.code, '둘째 보호자')]);
  assert.deepEqual(results.map(result => result.response.status).sort(), [201, 400]);
  assert.equal((await f.connect(fresh.code)).response.status, 400);
  assert.equal((await f.api('/v1/patient/invite', 'POST', patient, {})).response.status, 409);
  const connected = await f.api<PatientConnection>('/v1/patient/connection', 'GET', patient);
  assert.ok(['첫 보호자', '둘째 보호자'].includes(connected.body.caregiverName!));
});

test('shared snapshots validate all fields and replace records using a server timestamp', async t => {
  const f = await fixture(t);
  const patient = await f.patient();
  const caregiver = await f.pair(patient);
  const base = snapshot();
  const invalid = [
    { ...base, updatedAt: '2020-01-01T00:00:00.000Z' },
    { ...base, token: 'private-device-token' },
    { ...base, nextVisit: null },
    { ...base, nextVisit: { hospitalName: '의원', date: '2026-02-30', time: '09:11' } },
    { ...base, nextVisit: { hospitalName: '의원', date: '2026-11-03', time: '25:00' } },
    { ...base, nextVisit: { hospitalName: '', date: '2026-11-03', time: '09:11' } },
    { ...base, nextVisit: { hospitalName: '의원', date: '2026-11-03', time: '09:11', phone: '010-0000-0000' } },
    { ...base, visitUpdate: {} },
    { ...base, visitUpdate: { connectedAt: new Date(NOW).toISOString(), enabled: true, consentRevision: 0, scheduleRevision: 0 } },
    { ...base, visitUpdate: { connectedAt: new Date(NOW).toISOString(), enabled: true, consentRevision: 1, scheduleRevision: -1 } },
    { ...base, nextVisit: { hospitalName: '의원', date: '2026-11-03', time: '09:11' },
      visitUpdate: { connectedAt: new Date(NOW).toISOString(), enabled: false, consentRevision: 1, scheduleRevision: 0 } },
    { ...base, patientName: 'x'.repeat(41) },
    { ...base, schedule: { frequency: 'three', times: ['08:00', '18:00'] } },
    { ...base, schedule: { frequency: 'twice', times: ['08:00', '08:00'] } },
    { ...base, schedule: { frequency: 'twice', times: ['18:00', '08:00'] } },
    { ...base, schedule: { frequency: 'once', times: ['25:00'] } },
    { ...base, schedule: { frequency: 'once', times: ['08:00'], uri: 'file://private' } },
    { ...base, doses: [{ ...base.doses[0], date: '2026-02-30' }] },
    { ...base, doses: [{ ...base.doses[0], time: '08:60' }] },
    { ...base, doses: [{ ...base.doses[0], label: 'x'.repeat(81) }] },
    { ...base, doses: [{ ...base.doses[0], takenAt: 'yesterday' }] },
    { ...base, doses: [{ ...base.doses[0], takenAt: undefined }] },
    { ...base, doses: [{ ...base.doses[0], photo: { ...base.doses[0].photo, capturedAt: '2026-11-01T00:01:00.000Z' } }] },
    { ...base, doses: [{ ...base.doses[0], status: 'pending' }] },
    { ...base, doses: [{ ...base.doses[0], photo: { ...base.doses[0].photo, uri: 'file://patient/image.jpg' } }] },
    { ...base, doses: [{ ...base.doses[0], photo: { ...base.doses[0].photo, verified: 'yes' } }] },
    { ...base, doses: [base.doses[0], base.doses[0]] },
    { ...base, doses: [base.doses[0], { ...base.doses[0], id: 'another-dose' }] },
    { ...base, doses: [{ ...base.doses[1], date: '2026-01-01' }, base.doses[0]] },
    { ...base, doses: Array.from({ length: 301 }, (_, index) => ({ ...base.doses[1], id: `dose-${index}` })) },
  ];
  for (const input of invalid) assert.equal((await f.api('/v1/patient/snapshot', 'PUT', patient, input)).response.status, 400);
  assert.equal((await f.api<CaregiverData>('/v1/caregiver/snapshot', 'GET', caregiver)).body.snapshot, null);
  const published = await f.api<CareSnapshot>('/v1/patient/snapshot', 'PUT', patient, base);
  assert.deepEqual(published.body, { ...base, updatedAt: new Date(NOW).toISOString() });
  // Self-reported records without a photo remain distinct from photo evidence.
  const selfReported: SnapshotInput = { ...base, doses: [{ ...base.doses[1], status: 'taken', takenAt: new Date(NOW).toISOString() }] };
  assert.equal((await f.api('/v1/patient/snapshot', 'PUT', patient, selfReported)).response.status, 200);
  const synced = await f.api<CaregiverData>('/v1/caregiver/snapshot', 'GET', caregiver);
  assert.equal(synced.body.snapshot?.doses.length, 1);
  assert.equal(synced.body.snapshot?.doses[0].photo, undefined);
});

test('a shared visit is removed on the next unshared snapshot and expires without another patient upload', async t => {
  let clock = new Date(2026, 10, 1, 9, 10).getTime();
  const f = await fixture(t, { now: () => clock });
  const patient = await f.patient();
  const caregiver = await f.pair(patient);
  const getShared = async () => (await f.api<CaregiverData>('/v1/caregiver/snapshot', 'GET', caregiver)).body.snapshot!;
  const base = snapshot();
  const nextVisit = { hospitalName: '시연 의원', date: '2026-11-01', time: '09:11' };
  const visitUpdate = { connectedAt: new Date(clock).toISOString(), consentRevision: 1, enabled: true, scheduleRevision: 10 };
  const publish = async (input: unknown) => assert.equal((await f.api('/v1/patient/snapshot', 'PUT', patient, input)).response.status, 200);
  await publish({ ...base, nextVisit, visitUpdate });
  await f.restart();
  assert.deepEqual((await getShared()).nextVisit, nextVisit);
  await publish({ ...base, visitUpdate: { ...visitUpdate, enabled: false, consentRevision: 2 } });
  assert.ok(!Object.hasOwn(await getShared(), 'nextVisit'));
  assert.ok(!(await readFile(f.dataPath, 'utf8')).includes('시연 의원'));
  await publish({ ...base, nextVisit, visitUpdate: { ...visitUpdate, consentRevision: 3 } });
  clock = new Date(2026, 10, 1, 9, 11).getTime();
  await f.restart();
  const expired = await getShared();
  assert.ok(!Object.hasOwn(expired, 'nextVisit'));
  assert.deepEqual(expired.doses, base.doses);
  await publish({ ...base, nextVisit, visitUpdate: { ...visitUpdate, consentRevision: 3 } });
  assert.ok(!(await readFile(f.dataPath, 'utf8')).includes('시연 의원'));
});

test('unversioned heartbeats and stale tabs cannot overwrite the newer agenda or revive withdrawn consent', async t => {
  let clock = NOW;
  const f = await fixture(t, { now: () => clock });
  const patient = await f.patient();
  const caregiver = await f.pair(patient);
  const connection = async () => (await f.api<PatientConnection>('/v1/patient/connection', 'GET', patient)).body;
  const shared = async (token = caregiver) => (await f.api<CaregiverData>('/v1/caregiver/snapshot', 'GET', token)).body.snapshot!;
  const publish = async (fields: object) => assert.equal((await f.api('/v1/patient/snapshot', 'PUT', patient, { ...snapshot(), ...fields })).response.status, 200);
  const first = { hospitalName: '첫 병원', date: '2026-11-02', time: '14:00' };
  const second = { ...first, hospitalName: '변경 병원' };
  const optIn = { connectedAt: (await connection()).connectedAt!, enabled: true, consentRevision: 1, scheduleRevision: 100 };

  await publish({ nextVisit: first }); // pre-versioned code cannot enable sharing
  assert.equal((await shared()).nextVisit, undefined);
  await publish({ nextVisit: first, visitUpdate: optIn });
  await publish({}); // the original medication-only app
  assert.deepEqual((await shared()).nextVisit, first);
  await publish({ nextVisit: second, visitUpdate: { ...optIn, scheduleRevision: 110 } });
  await publish({ nextVisit: first, visitUpdate: optIn });
  assert.deepEqual((await shared()).nextVisit, second);

  await publish({ visitUpdate: { ...optIn, consentRevision: 2, enabled: false } });
  await f.restart();
  await publish({ nextVisit: first });
  await publish({ nextVisit: second, visitUpdate: { ...optIn, scheduleRevision: 120 } });
  await publish({ nextVisit: second, visitUpdate: { ...optIn, consentRevision: 2, scheduleRevision: 120 } }); // tied opt-out wins
  assert.equal((await shared()).nextVisit, undefined);
  assert.deepEqual((await connection()).visitConsent, { revision: 2, enabled: false });

  const reenable = { ...optIn, consentRevision: 3 };
  await publish({ nextVisit: first, visitUpdate: reenable }); // opt-in from a tab missing the newer edit
  assert.equal((await shared()).nextVisit, undefined);
  assert.deepEqual((await connection()).visitConsent, { revision: 3, enabled: true });
  await publish({ nextVisit: second, visitUpdate: { ...reenable, scheduleRevision: 110 } });
  assert.deepEqual((await shared()).nextVisit, second);
  await publish({ visitUpdate: { ...reenable, scheduleRevision: 120 } }); // actual deletion
  await publish({ nextVisit: second, visitUpdate: { ...reenable, scheduleRevision: 110 } });
  assert.equal((await shared()).nextVisit, undefined);

  await f.api('/v1/caregiver/connection', 'DELETE', caregiver);
  clock += 1000;
  const other = await f.pair(patient);
  await publish({ nextVisit: second, visitUpdate: { ...reenable, consentRevision: 4 } }); // previous caregiver's opt-in
  assert.equal((await shared(other)).nextVisit, undefined);
  assert.equal((await connection()).visitConsent, undefined);
});

test('tokens, invitations, records and photographs survive restart without plaintext credentials on disk', async t => {
  const f = await fixture(t);
  const patient = await f.patient();
  const invite = await f.invite(patient);
  let disk = await readFile(f.dataPath, 'utf8');
  assert.ok(!disk.includes(patient) && !disk.includes(invite.code));
  await f.restart();
  const linked = await f.connect(invite.code);
  assert.equal(linked.response.status, 201);
  const caregiver = linked.body.token;
  await f.api('/v1/patient/snapshot', 'PUT', patient, snapshot());
  assert.equal((await f.api('/v1/patient/photos/photo-first', 'PUT', patient, { dataUri: PNG })).response.status, 200);
  disk = await readFile(f.dataPath, 'utf8');
  assert.ok(!disk.includes(patient) && !disk.includes(caregiver) && !disk.includes(invite.code));
  await f.restart();
  assert.equal((await f.api<CaregiverData>('/v1/caregiver/snapshot', 'GET', caregiver)).body.snapshot?.patientName, '김환자');
  assert.equal((await f.api('/v1/caregiver/photos/photo-first', 'GET', caregiver)).body.dataUri, PNG);
  assert.equal((await f.connect(invite.code)).response.status, 400);
});

test('either device can revoke the connection, erasing consented records and invalidating old tokens and invites', async t => {
  const f = await fixture(t);
  const patient = await f.patient();
  const invite = await f.invite(patient);
  const caregiver = (await f.connect(invite.code)).body.token;
  await f.api('/v1/patient/snapshot', 'PUT', patient, snapshot());
  await f.api('/v1/patient/photos/photo-first', 'PUT', patient, { dataUri: PNG });
  assert.equal((await f.api('/v1/patient/connection', 'DELETE', patient)).response.status, 200);
  assert.equal((await f.api('/v1/caregiver/snapshot', 'GET', caregiver)).response.status, 401);
  assert.equal((await f.api('/v1/caregiver/photos/photo-first', 'GET', caregiver)).response.status, 401);
  assert.equal((await f.connect(invite.code)).response.status, 400);
  // A heartbeat that was queued before unlink may arrive after it, even after a restart.
  await f.restart();
  const late = await f.api('/v1/patient/snapshot', 'PUT', patient, snapshot());
  assert.equal(late.response.status, 200);
  assert.equal(late.body.sharingRevoked, true);
  assert.ok(!(await readFile(f.dataPath, 'utf8')).includes('김환자'));
  const second = await f.pair(patient);
  assert.equal((await f.api<CaregiverData>('/v1/caregiver/snapshot', 'GET', second)).body.snapshot, null);
  await f.api('/v1/patient/snapshot', 'PUT', patient, snapshot());
  assert.equal((await f.api('/v1/caregiver/connection', 'DELETE', second)).response.status, 200);
  assert.equal((await f.api('/v1/caregiver/snapshot', 'GET', second)).response.status, 401);
  assert.deepEqual((await f.api<PatientConnection>('/v1/patient/connection', 'GET', patient)).body, { caregiverName: null, connectedAt: null, sharingRevoked: true });
  assert.equal((await f.api('/v1/patient/snapshot', 'PUT', patient, snapshot())).body.sharingRevoked, true);
  const third = await f.pair(patient);
  assert.equal((await f.api<CaregiverData>('/v1/caregiver/snapshot', 'GET', third)).body.snapshot, null);
  await f.api('/v1/patient/connection', 'DELETE', patient);
  const unconsumed = await f.invite(patient);
  await f.api('/v1/patient/connection', 'DELETE', patient);
  assert.equal((await f.connect(unconsumed.code)).response.status, 400);
  await f.api('/v1/patient/snapshot', 'PUT', patient, snapshot());
  assert.ok(!(await readFile(f.dataPath, 'utf8')).includes('김환자'));
  await f.restart();
  assert.equal((await f.api('/v1/caregiver/snapshot', 'GET', third)).response.status, 401);
  assert.equal((await f.api('/v1/patient/connection', 'GET', patient)).response.status, 200);
});

test('photos require current references and matching family, have byte limits, and are pruned and retained at most 30', async t => {
  const f = await fixture(t);
  const patient = await f.patient();
  const outsider = await f.patient();
  const caregiver = await f.pair(patient);
  const otherCaregiver = await f.pair(outsider);
  assert.equal((await f.api('/v1/patient/photos/photo-first', 'PUT', patient, { dataUri: PNG })).response.status, 404);
  await f.api('/v1/patient/snapshot', 'PUT', patient, snapshot());
  assert.equal((await f.api('/v1/caregiver/photos/photo-first', 'GET', caregiver)).response.status, 404);
  for (const body of [{ dataUri: 'file://private.jpg' }, { dataUri: 'data:text/html;base64,PHNjcmlwdD4=' }, { dataUri: 'data:image/png;base64,YWJj' }, { dataUri: PNG, uri: 'file://private.jpg' }]) {
    assert.equal((await f.api('/v1/patient/photos/photo-first', 'PUT', patient, body)).response.status, 400);
  }
  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);
  oversized.set([0xff, 0xd8, 0xff]);
  assert.equal((await f.api('/v1/patient/photos/photo-first', 'PUT', patient, { dataUri: `data:image/jpeg;base64,${oversized.toString('base64')}` })).response.status, 400);
  assert.equal((await f.api('/v1/patient/photos/photo-first', 'PUT', patient, { dataUri: PNG })).response.status, 200);
  assert.equal((await f.api('/v1/patient/photos/photo-first', 'PUT', caregiver, { dataUri: PNG })).response.status, 401);
  assert.equal((await f.api('/v1/caregiver/photos/photo-first', 'GET', caregiver)).body.dataUri, PNG);
  assert.equal((await f.api('/v1/caregiver/photos/photo-first', 'GET', otherCaregiver)).response.status, 404);
  await f.api('/v1/patient/snapshot', 'PUT', patient, { ...snapshot(), doses: [] });
  assert.equal((await f.api('/v1/caregiver/photos/photo-first', 'GET', caregiver)).response.status, 404);
  assert.ok(!(await readFile(f.dataPath, 'utf8')).includes(PNG));
  const many: SnapshotInput = { ...snapshot(), doses: Array.from({ length: 31 }, (_, index) => ({ ...snapshot().doses[0], id: `dose-${index}`, photo: { id: `photo-${index}`, capturedAt: new Date(NOW).toISOString(), verified: false } })) };
  assert.equal((await f.api('/v1/patient/snapshot', 'PUT', patient, many)).response.status, 200);
  for (let index = 0; index < 31; index++) assert.equal((await f.api(`/v1/patient/photos/photo-${index}`, 'PUT', patient, { dataUri: PNG })).response.status, 200);
  assert.equal((await f.api('/v1/caregiver/photos/photo-0', 'GET', caregiver)).response.status, 404);
  assert.equal((await f.api('/v1/caregiver/photos/photo-30', 'GET', caregiver)).response.status, 200);
  const stored = JSON.parse(await readFile(f.dataPath, 'utf8')) as { patients: { photos: unknown[] }[] };
  assert.equal(stored.patients[0].photos.length, 30);
});

test('origin allowlist, JSON request limits, and bounded invitation guesses protect the boundary', async t => {
  let clock = NOW;
  const f = await fixture(t, { now: () => clock, rateLimit: { maxRequests: 3, windowMs: 60000 }, allowedOrigins: ['http://192.168.1.50:8082'] });
  const patient = await f.patient();
  const allowed = await f.api('/v1/patient/connection', 'GET', patient, undefined, { Origin: 'http://localhost:8082' });
  assert.equal(allowed.response.headers.get('access-control-allow-origin'), 'http://localhost:8082');
  assert.equal((await f.api('/v1/patient/connection', 'GET', patient, undefined, { Origin: 'http://192.168.1.50:8082' })).response.status, 200);
  const denied = await f.api('/v1/patient/connection', 'GET', patient, undefined, { Origin: 'https://attacker.invalid' });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.response.headers.get('access-control-allow-origin'), null);
  assert.equal((await f.api('/v1/patient/snapshot', 'OPTIONS', undefined, undefined, { Origin: 'http://localhost:8082' })).response.status, 204);
  assert.equal((await f.api('/v1/patient/snapshot', 'PUT', patient, snapshot(), { 'Content-Type': 'text/plain' })).response.status, 415);
  assert.equal((await f.api('/v1/patient/snapshot', 'PUT', patient, { padding: 'x'.repeat(256 * 1024) })).response.status, 413);
  const malformed = await fetch(`http://127.0.0.1:${f.port()}/v1/patient/snapshot`, { method: 'PUT', headers: { Authorization: `Bearer ${patient}`, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await f.connect('12345678')).response.status, 400);
  assert.equal((await f.connect('87654321')).response.status, 400);
  assert.equal((await f.connect('55555555')).response.status, 429);
  assert.equal((await f.api('/v1/patient/connection', 'GET', patient)).response.status, 200);
  clock += 60000;
  assert.equal((await f.connect('55555555')).response.status, 400);
});

test('failed persistence is not acknowledged and never replaces the in-memory snapshot', async t => {
  const f = await fixture(t);
  const patient = await f.patient();
  const caregiver = await f.pair(patient);
  await f.api('/v1/patient/snapshot', 'PUT', patient, snapshot('저장된 이름'));
  const original = await readFile(f.dataPath, 'utf8');
  await rm(f.dataPath);
  await mkdir(f.dataPath); // Force atomic replacement to fail without changing permissions.
  const failed = await f.api('/v1/patient/snapshot', 'PUT', patient, snapshot('실패한 변경'));
  assert.equal(failed.response.status, 503);
  assert.equal((await f.api<CaregiverData>('/v1/caregiver/snapshot', 'GET', caregiver)).body.snapshot?.patientName, '저장된 이름');
  await rmdir(f.dataPath);
  await writeFile(f.dataPath, original);
  await f.restart();
  assert.equal((await f.api<CaregiverData>('/v1/caregiver/snapshot', 'GET', caregiver)).body.snapshot?.patientName, '저장된 이름');
});

test('invalid persisted data fails closed and leaves the original file intact', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'metacare-care-invalid-'));
  const dataPath = join(directory, 'care.json');
  t.after(() => removeTestDirectory(directory));
  for (const invalid of ['{', JSON.stringify({ version: 1, patients: [], token: 'leak' }), JSON.stringify({ version: 1, patients: [{ tokenHash: 'plaintext' }] })]) {
    await writeFile(dataPath, invalid);
    await assert.rejects(startCareServer({ port: 0, dataPath }), /invalid/i);
    assert.equal(await readFile(dataPath, 'utf8'), invalid);
  }
});
