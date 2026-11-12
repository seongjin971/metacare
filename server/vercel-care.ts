import { isIP } from 'node:net';
import type { Pool, PoolClient } from 'pg';
import { AGENDA_SNAPSHOT_PATH, hash, photoIds, routeCare, tokenDigest, type CareStore, type Patient, type Role } from './care-core.ts';
import { HttpError } from './care-errors.ts';
import { pruneVercelPhotos, routeVercelPhoto } from './vercel-photos.ts';
import { parseOverdueSettings, type EnqueueOverdue } from './overdue.ts';
import { getOverdueSettings, reconcileOverdue, setOverdueSettings } from './vercel-overdue.ts';

const snapshotLimit = 256 * 1024;
const photoPartLimit = 4_200_000; // 3 MiB base64 plus JSON, below Vercel's 4.5 MB request limit.
const tenMinutes = 10 * 60_000;
const patientColumns = 'id, token_hash AS "tokenHash", snapshot, visit_update AS "visitUpdate", invite, caregiver, sharing_revoked AS "sharingRevoked"';
const tokenColumns: Record<Role, string> = { patient: 'token_hash', caregiver: "(caregiver->>'tokenHash')" };

/** Without a queue (local tests, misconfigured deploys) caregiver alerts stay off rather than half-working. */
function transactionStore(client: PoolClient, now: () => number, enqueue?: EnqueueOverdue): CareStore {
  async function find(column: string, value: string) {
    // column is a fixed expression selected below, never taken from the request.
    const result = await client.query<Omit<Patient, 'photos'>>(
      'SELECT ' + patientColumns + ' FROM metacare_patients WHERE ' + column + ' = $1 FOR UPDATE', [value],
    );
    const row = result.rows[0];
    return row ? { ...row, visitUpdate: row.visitUpdate ?? undefined, photos: [] } : undefined;
  }
  return {
    byToken: (role, digest) => find(tokenColumns[role], digest),
    byInvite: digest => find("(invite->>'codeHash')", digest),
    async inviteExists(digest) {
      // Only invitation issuers take this short lock; all other families can proceed.
      await client.query('SELECT pg_advisory_xact_lock(52658103)');
      const result = await client.query("SELECT 1 FROM metacare_patients WHERE invite->>'codeHash' = $1", [digest]);
      return result.rows.length > 0;
    },
    async create(patient) {
      await client.query('INSERT INTO metacare_patients(id,token_hash) VALUES ($1,$2)', [patient.id, patient.tokenHash]);
    },
    async replace(patient) {
      await client.query('UPDATE metacare_patients SET snapshot=$2, visit_update=$3, invite=$4, caregiver=$5, sharing_revoked=$6 WHERE id=$1',
        [patient.id, patient.snapshot, patient.visitUpdate ?? null, patient.invite, patient.caregiver, patient.sharingRevoked ?? false]);
      await pruneVercelPhotos(client, patient.id, patient.caregiver ? [...photoIds(patient)] : []);
      if (enqueue) await reconcileOverdue(client, patient, now(), enqueue);
    },
    ...(enqueue && {
      async alerts(patient: Patient, method: string, body: unknown, at: number) {
        const value = method === 'GET' ? await getOverdueSettings(client, patient)
          : await setOverdueSettings(client, patient, parseOverdueSettings(body), at, enqueue);
        return { status: 200, body: value };
      },
    }),
    photoParts: (...args) => routeVercelPhoto(client, ...args),
  };
}

function endpoint(request: Request): string {
  const url = new URL(request.url);
  const requestedVisits = url.searchParams.getAll('visits');
  const agenda = requestedVisits.length === 1 && requestedVisits[0] === 'upcoming' && (request.method === 'GET' || request.method === 'OPTIONS');
  if (agenda) url.searchParams.delete('visits');
  const query = [...url.searchParams];
  let path = url.pathname;
  // Depending on the runtime adapter, the function sees the rewrite destination or the external path.
  if (query.length === 1 && query[0][0] === 'careRoute') {
    path = '/v1/' + query[0][1];
    if (!/^\/v1\/[A-Za-z0-9_/-]+$/.test(path) || (url.pathname !== '/api/care' && url.pathname !== path)) throw new HttpError(400, 'Invalid route.');
  } else if (query.length) throw new HttpError(400, 'Query parameters are not supported.');
  if (!path.startsWith('/v1/')) throw new HttpError(404, 'Route not found.');
  if (agenda && path !== '/v1/caregiver/snapshot') throw new HttpError(400, 'Query parameters are not supported.');
  return agenda ? AGENDA_SNAPSHOT_PATH : path;
}

async function readBody(request: Request, limit: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')
    || ![null, 'identity'].includes(request.headers.get('content-encoding'))) throw new HttpError(415, 'Use application/json.');
  if (Number(request.headers.get('content-length')) > limit) throw new HttpError(413, 'Request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Invalid JSON.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new HttpError(413, 'Request is too large.');
      }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Invalid JSON.');
  } finally { reader.releaseLock(); }
}

async function requireEmptyBody(request: Request): Promise<void> {
  const invalid = () => new HttpError(400, 'This request does not accept a body.');
  const length = request.headers.get('content-length');
  if (length !== null && !/^0+$/.test(length)) throw invalid();
  // Vercel may expose a stream even when a DELETE carries zero bytes.
  const reader = request.body?.getReader();
  if (!reader) return;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value.byteLength > 0) {
        void reader.cancel().catch(() => {});
        throw invalid();
      }
    }
  } catch {
    throw invalid();
  } finally { reader.releaseLock(); }
}

async function countAttempt(pool: Pool, key: string, now: number, maximum: number) {
  const result = await pool.query<{ hits: number }>(
    `INSERT INTO metacare_rate_limits(ip_hash, reset_at, hits) VALUES($1, $3, 1)
     ON CONFLICT(ip_hash) DO UPDATE SET
       hits=CASE WHEN metacare_rate_limits.reset_at <= $2 THEN 1 ELSE LEAST(metacare_rate_limits.hits + 1, $4) END,
       reset_at=CASE WHEN metacare_rate_limits.reset_at <= $2 THEN $3 ELSE metacare_rate_limits.reset_at END
     RETURNING hits`, [key, new Date(now), new Date(now + tenMinutes), maximum + 1],
  );
  if (result.rows[0].hits > maximum) throw new HttpError(429, '연결 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.');
}

async function rateLimit(pool: Pool, request: Request, now: number) {
  // Vercel populates this header at its edge. Local tests without it share a single bucket.
  const ip = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? '';
  await pool.query('DELETE FROM metacare_rate_limits WHERE reset_at <= $1', [new Date(now)]);
  await countAttempt(pool, hash(isIP(ip) ? ip : 'unknown'), now, 30);
  await countAttempt(pool, 'all', now, 3000);
}

type Options = { now?: () => number; allowedOrigins?: string[]; enqueue?: EnqueueOverdue };

function isDeployedWebOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/\.$/, '');
    // Vercel serves named HTTPS sites. Local origins belong to the PC preview server.
    return url.protocol === 'https:' && url.origin === value && host.includes('.')
      && !isIP(host) && !/(^|\.)(localhost|local|internal|lan|home\.arpa)$/.test(host);
  } catch { return false; }
}

export function createVercelCareHandler(pool: Pool, options: Options = {}) {
  const now = options.now ?? Date.now;
  const configuredOrigins = [process.env.CARE_ALLOWED_ORIGINS, process.env.CARE_WEB_PREVIEW_ORIGINS]
    .flatMap(value => value?.split(',') ?? []).map(value => value.trim()).filter(Boolean);
  const origins = new Set((options.allowedOrigins ?? configuredOrigins).filter(isDeployedWebOrigin));
  return async function handle(request: Request): Promise<Response> {
    const headers = new Headers({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' });
    try {
      const origin = request.headers.get('origin');
      if (origin !== null) {
        if (!origins.has(origin)) throw new HttpError(403, 'Origin is not allowed.');
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      }
      const path = endpoint(request);
      if (request.method !== 'PUT' && request.method !== 'POST') await requireEmptyBody(request);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (path === '/v1/health' && request.method === 'GET') {
        await pool.query('SELECT 1 FROM metacare_patients, metacare_rate_limits, metacare_photos, metacare_photo_uploads LIMIT 0');
        return Response.json({ status: 'ok' }, { headers });
      }
      if (request.method === 'POST' && (path === '/v1/patients' || path === '/v1/caregivers/connect')) {
        // Count even failed guesses, independently of the domain transaction rollback.
        await rateLimit(pool, request, now());
      }
      const authorization = request.headers.get('authorization') ?? undefined;
      const role: Role | undefined = path.startsWith('/v1/patient/') ? 'patient' : path.startsWith('/v1/caregiver/') ? 'caregiver' : undefined;
      if (role) tokenDigest(authorization);
      const photo = path.startsWith('/v1/patient/photos/') && request.method === 'PUT';
      if (photo) {
        const exists = await pool.query('SELECT 1 FROM metacare_patients WHERE token_hash=$1 AND caregiver IS NOT NULL', [tokenDigest(authorization)]);
        if (!exists.rows.length) throw new HttpError(401, '사진을 공유할 수 있는 연결이 없어요.');
      }
      let body: unknown;
      if (request.method === 'POST' || request.method === 'PUT') body = await readBody(request, photo ? photoPartLimit : snapshotLimit);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await routeCare(transactionStore(client, now, options.enqueue), request.method, path, authorization, body, now, tenMinutes);
        await client.query('COMMIT');
        return Response.json(result.body, { status: result.status, headers });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    } catch (error) {
      const known = error instanceof HttpError;
      return Response.json({ error: known ? error.message : '공유 서버를 사용할 수 없어요. 잠시 후 다시 시도해 주세요.' },
        { status: known ? error.status : 503, headers });
    }
  };
}
