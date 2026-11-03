/**
 * Authenticated LOCAL prototype for explicit patient-to-caregiver sharing.
 * Tokens and invitation codes are persisted only as hashes. All operations are
 * serialized; durable atomic replacement precedes every successful mutation.
 * This is not a deployed medical service: use synthetic records on localhost.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { keys, record, routeCare, tokenDigest, validPatient, type CareStore, type Patient } from './care-core.ts';
import { HttpError } from './care-errors.ts';

type State = { version: 1; patients: Patient[] };
type Options = {
  port?: number;
  host?: string;
  dataPath?: string;
  allowedOrigins?: string[];
  now?: () => number;
  inviteTtlMs?: number;
  rateLimit?: { maxRequests: number; windowMs: number };
};
const DEFAULT_DATA_PATH = fileURLToPath(new URL('./data/care.json', import.meta.url));
const JSON_LIMIT = 256 * 1024;
const PHOTO_REQUEST_LIMIT = 7 * 1024 * 1024;
const DEFAULT_ORIGINS = ['localhost', '127.0.0.1'].flatMap(host => [8081, 8082, 8083].map(port => `http://${host}:${port}`));

async function loadState(dataPath: string): Promise<State> {
  let contents: string;
  try { contents = await readFile(dataPath, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, patients: [] };
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(contents); } catch { throw new Error('Care data is invalid. Preserve and repair the file before starting.'); }
  if (!record(value) || !keys(value, ['version', 'patients']) || value.version !== 1
    || !Array.isArray(value.patients) || !value.patients.every(validPatient)) throw new Error('Care data is invalid. Preserve and repair the file before starting.');
  const patients = value.patients;
  const tokens = patients.flatMap(patient => [patient.tokenHash, ...(patient.caregiver ? [patient.caregiver.tokenHash] : [])]);
  const invites = patients.flatMap(patient => patient.invite ? [patient.invite.codeHash] : []);
  if (new Set(patients.map(patient => patient.id)).size !== patients.length || new Set(tokens).size !== tokens.length
    || new Set(invites).size !== invites.length) throw new Error('Care data has duplicate identities. Preserve and repair the file before starting.');
  return { version: 1, patients };
}

async function persist(dataPath: string, state: State): Promise<void> {
  await mkdir(dirname(dataPath), { recursive: true });
  const temporary = `${dataPath}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(state)); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, dataPath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function readJson(request: IncomingMessage, limit: number): Promise<unknown> {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)
    || (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity')) {
    request.resume();
    throw new HttpError(415, 'Use application/json.');
  }
  return new Promise((resolveBody, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    let settled = false;
    const fail = (error: HttpError) => { if (!settled) { settled = true; reject(error); } };
    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > limit) { chunks.length = 0; fail(new HttpError(413, 'Request is too large.')); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Invalid JSON.')); }
    });
    request.on('error', () => fail(new HttpError(400, 'Request interrupted.')));
    request.on('aborted', () => fail(new HttpError(400, 'Request interrupted.')));
  });
}

export async function startCareServer(options: Options = {}) {
  const dataPath = options.dataPath ?? DEFAULT_DATA_PATH;
  let state = await loadState(dataPath);
  const now = options.now ?? Date.now;
  const ttl = options.inviteTtlMs ?? 10 * 60 * 1000;
  const rateLimit = options.rateLimit ?? { maxRequests: 30, windowMs: 10 * 60 * 1000 };
  if (!Number.isFinite(ttl) || ttl <= 0 || !Number.isInteger(rateLimit.maxRequests) || rateLimit.maxRequests < 1
    || !Number.isFinite(rateLimit.windowMs) || rateLimit.windowMs <= 0) throw new Error('Invalid care server limits.');
  const configuredOrigins: string[] = options.allowedOrigins ?? String(process.env.CARE_ALLOWED_ORIGINS ?? '').split(',').map(item => item.trim()).filter(Boolean);
  for (const origin of configuredOrigins) {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || parsed.username || parsed.password) throw new Error('CARE_ALLOWED_ORIGINS must contain exact HTTP(S) origins.');
  }
  const origins = new Set([...DEFAULT_ORIGINS, ...configuredOrigins]);
  const attempts = new Map<string, { count: number; resetAt: number }>();
  let queue: Promise<void> = Promise.resolve();
  let queued = 0;

  const save = async (patients: Patient[]) => {
    const next: State = { version: 1, patients };
    try { await persist(dataPath, next); }
    catch { throw new HttpError(503, '서버에 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    state = next;
  };

  const store: CareStore = {
    byToken: (role, tokenHash) => state.patients.find(item => (role === 'patient' ? item.tokenHash : item.caregiver?.tokenHash) === tokenHash),
    byInvite: codeHash => state.patients.find(item => item.invite?.codeHash === codeHash),
    inviteExists: codeHash => state.patients.some(item => item.invite?.codeHash === codeHash),
    create: patient => save([...state.patients, patient]),
    replace: patient => save(state.patients.map(item => item.id === patient.id ? patient : item)),
  };
  const limited = (request: IncomingMessage) => {
    const timestamp = now();
    for (const [key, value] of attempts) if (value.resetAt <= timestamp) attempts.delete(key);
    const key = request.socket.remoteAddress ?? 'unknown';
    let entry = attempts.get(key);
    if (!entry) {
      if (attempts.size >= 10000) throw new HttpError(429, '연결 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.');
      entry = { count: 0, resetAt: timestamp + rateLimit.windowMs };
      attempts.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > rateLimit.maxRequests) throw new HttpError(429, '연결 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.');
  };

  const respond = (response: ServerResponse, status: number, body: unknown) => {
    if (response.destroyed || response.writableEnded) return;
    response.statusCode = status;
    response.end(JSON.stringify(body));
  };
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Origin');
    void (async () => {
      const origin = request.headers.origin;
      if (origin) {
        if (!origins.has(origin)) throw new HttpError(403, 'Origin is not allowed.');
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      }
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.search) throw new HttpError(400, 'Query parameters are not supported.');
      if (request.method === 'OPTIONS') { response.statusCode = 204; response.end(); return; }
      if (request.method === 'POST' && (url.pathname === '/v1/patients' || url.pathname === '/v1/caregivers/connect')) limited(request);
      // Check credentials before accepting a potentially large photo body. The
      // queued route checks again, so a concurrent revocation cannot be bypassed.

      const role = url.pathname.startsWith('/v1/patient/') ? 'patient' : url.pathname.startsWith('/v1/caregiver/') ? 'caregiver' : null;
      if (role) {
        const authorizationHeaders = request.rawHeaders.filter((header, index) => index % 2 === 0 && header.toLowerCase() === 'authorization');
        if (authorizationHeaders.length !== 1 || !await store.byToken(role, tokenDigest(request.headers.authorization))) {
          throw new HttpError(401, '기기 인증이 만료되었거나 연결이 해제되었어요. 다시 연결해 주세요.');
        }
      }
      if (queued >= 50) throw new HttpError(503, '서버가 사용 중이에요. 잠시 후 다시 시도해 주세요.');
      queued += 1;
      try {
        let body: unknown;
        if (request.method === 'POST' || request.method === 'PUT') body = await readJson(request, /^\/v1\/patient\/photos\//.test(url.pathname) ? PHOTO_REQUEST_LIMIT : JSON_LIMIT);
        else if (request.headers['transfer-encoding'] || Number(request.headers['content-length'] ?? 0) > 0) throw new HttpError(400, 'This request does not accept a body.');
        const operation = queue.then(() => routeCare(store, request.method ?? '', url.pathname, request.headers.authorization, body, now, ttl));
        queue = operation.then(() => {}, () => {});
        const result = await operation;
        respond(response, result.status, result.body);
      } finally { queued -= 1; }
    })().catch((error: unknown) => {
      request.resume();
      respond(response, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.' });
    });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.maxRequestsPerSocket = 100;
  await new Promise<void>((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 8789, options.host ?? '127.0.0.1', () => { server.off('error', reject); resolveReady(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Care server did not expose a TCP address.');
  let closing: Promise<void> | undefined;
  return {
    server,
    address,
    port: address.port,
    close: () => {
      closing ??= (async () => {
        const closed = new Promise<void>((resolveClosed, reject) => server.close(error => error ? reject(error) : resolveClosed()));
        await queue;
        await closed;
      })();
      return closing;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.CARE_PORT ?? 8789);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CARE_PORT must be a valid TCP port.');
  const running = await startCareServer({ port, host: process.env.CARE_HOST ?? '127.0.0.1' });
  console.log(`MetaCare local sharing prototype listening on http://${running.address.address}:${running.port}`);
  console.log('LOCAL PROTOTYPE: use synthetic records; not a deployed medical service.');
  const shutdown = () => { void running.close().then(() => process.exit(0)); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
