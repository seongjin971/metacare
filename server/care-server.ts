/**
 * Authenticated LOCAL prototype for explicit patient-to-caregiver sharing.
 * Device authentication tokens and invitation codes are persisted only as hashes. All operations are
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
import { claimLocalAlert, disableLocalAlert, planLocalAlert, updateLocalAlerts, validLocalAlerts, type LocalAlert } from './local-overdue.ts';
import { RetryablePushError, sendOverduePush, webPushPublicConfig } from './overdue.ts';

type State = { version: 1; patients: Patient[]; alerts: LocalAlert[] };
type Options = {
  port?: number;
  host?: string;
  dataPath?: string;
  allowedOrigins?: string[];
  now?: () => number;
  sendOverdue?: typeof sendOverduePush;
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, patients: [], alerts: [] };
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(contents); } catch { throw new Error('Care data is invalid. Preserve and repair the file before starting.'); }
  if (!record(value) || !keys(value, ['version', 'patients'], ['alerts']) || value.version !== 1
    || !Array.isArray(value.patients) || !value.patients.every(validPatient)) throw new Error('Care data is invalid. Preserve and repair the file before starting.');
  const patients = value.patients;
  const tokens = patients.flatMap(patient => [patient.tokenHash, ...(patient.caregiver ? [patient.caregiver.tokenHash] : [])]);
  const invites = patients.flatMap(patient => patient.invite ? [patient.invite.codeHash] : []);
  if (new Set(patients.map(patient => patient.id)).size !== patients.length || new Set(tokens).size !== tokens.length
    || new Set(invites).size !== invites.length) throw new Error('Care data has duplicate identities. Preserve and repair the file before starting.');
  const alerts = Object.hasOwn(value, 'alerts') ? value.alerts : [];
  if (!validLocalAlerts(alerts, patients)) throw new Error('Care notification data is invalid. Preserve and repair the file before starting.');
  for (const alert of alerts) if (alert.settings.enabled && !alert.registrationId) alert.registrationId = randomUUID();
  return { version: 1, patients, alerts };
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
  let alarm: ReturnType<typeof setTimeout> | undefined;
  let stopping = false;
  const sendPush = options.sendOverdue ?? sendOverduePush;

  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const operation = queue.then(work);
    queue = operation.then(() => {}, () => {});
    return operation;
  }
  function armTimer(retryDelay = 0) {
    clearTimeout(alarm);
    const due = state.alerts.reduce((min, alert) => alert.next ? Math.min(min, Math.max(alert.next.dueAt, alert.retryAt ?? 0)) : min, Infinity);
    if (stopping || !Number.isFinite(due)) return;
    alarm = setTimeout(() => {
      void serialize(deliverDue).catch(() => armTimer(5000));
    }, Math.max(retryDelay, 1, due - now()));
  }
  const save = async (patients: Patient[], alerts: LocalAlert[]) => {
    const next: State = { version: 1, patients, alerts };
    try { await persist(dataPath, next); }
    catch { throw new HttpError(503, '서버에 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    state = next;
    armTimer();
  };

  async function deliverDue() {
    for (const item of state.alerts) {
      const patient = state.patients.find(p => p.id === item.patientId && p.caregiver?.connectedAt === item.connectedAt);
      if (!patient) continue;
      const claim = claimLocalAlert(item, patient, now());
      if (!claim) continue;
      const replaceAlert = (replacement: LocalAlert) =>
        save(state.patients, state.alerts.map(alert => alert.patientId === item.patientId ? replacement : alert));
      // The claim and the following day's work survive a crash before or after the network call.
      await replaceAlert(claim.alert);
      if (!claim.notification) continue;
      const { token, slot } = claim.notification;
      let result: Awaited<ReturnType<typeof sendPush>>;
      try {
        result = await sendPush(token, slot, item.connectedAt);
      } catch (error) {
        // A definite provider refusal can be retried; a lost response may already have delivered the push.
        if (error instanceof RetryablePushError) await replaceAlert({ ...item, retryAt: now() + 60000 });
        else console.warn('보호자 알림 발송 결과를 확인하지 못했습니다.');
        continue;
      }
      if (result === 'unregistered') await replaceAlert(disableLocalAlert(claim.alert));
    }
    armTimer();
  }
  const store: CareStore = {
    byToken: (role, tokenHash) => state.patients.find(item => (role === 'patient' ? item.tokenHash : item.caregiver?.tokenHash) === tokenHash),
    byInvite: codeHash => state.patients.find(item => item.invite?.codeHash === codeHash),
    inviteExists: codeHash => state.patients.some(item => item.invite?.codeHash === codeHash),
    create: patient => save([...state.patients, patient], state.alerts),
    replace: patient => {
      const alerts = state.alerts.flatMap(alert => {
        if (alert.patientId !== patient.id) return [alert];
        if (patient.caregiver?.connectedAt !== alert.connectedAt) return [];
        return [planLocalAlert(alert, patient, now())];
      });
      return save(state.patients.map(item => item.id === patient.id ? patient : item), alerts);
    },
    alerts: async (patient, method, body, nowMs) => {
      if (method === 'PUT') await save(state.patients, updateLocalAlerts(state.alerts, patient, body, nowMs));
      const alert = state.alerts.find(item => item.patientId === patient.id);
      return { status: 200, body: { enabled: alert?.settings.enabled ?? false, threshold: alert?.settings.threshold ?? 30,
        ...(alert?.settings.enabled && { registrationId: alert.registrationId }) } };
    },
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
        if (url.pathname === '/v1/health' && request.method === 'GET') {
          respond(response, 200, { status: 'ok' }); return;
        }
        if (url.pathname === '/v1/web-push/key' && request.method === 'GET') {
          respond(response, 200, webPushPublicConfig()); return;
        }
        const result = await serialize(() => routeCare(store, request.method ?? '', url.pathname, request.headers.authorization, body, now, ttl));
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
  armTimer();
  let closing: Promise<void> | undefined;
  return {
    server,
    address,
    port: address.port,
    processDueAlerts: () => serialize(deliverDue),
    close: () => {
      closing ??= (async () => {
        stopping = true;
        clearTimeout(alarm);
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
