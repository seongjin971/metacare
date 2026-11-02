/**
 * Authenticated LOCAL prototype for explicit patient-to-caregiver sharing.
 * Tokens and invitation codes are persisted only as hashes. All operations are
 * serialized; durable atomic replacement precedes every successful mutation.
 * This is not a deployed medical service: use synthetic records on localhost.
 */
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CareSnapshot, PatientSnapshotUpdate, SharedDose, SharedVisit, VisitUpdate } from '../shared/care-types.ts';
import { isCareName as name, isCareDate as date, isCareTime as time, isSharedVisit, isUpcomingVisit } from '../shared/care-visit.ts';

type StoredPhoto = { id: string; dataUri: string };
type Patient = {
  id: string;
  tokenHash: string;
  snapshot: CareSnapshot | null;
  visitUpdate?: VisitUpdate;
  invite: { codeHash: string; expiresAt: string } | null;
  caregiver: { tokenHash: string; name: string; connectedAt: string } | null;
  photos: StoredPhoto[];
};
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
const PHOTO_BYTES_LIMIT = 5 * 1024 * 1024;
const MAX_PHOTOS = 30;
const DEFAULT_ORIGINS = ['localhost', '127.0.0.1'].flatMap(host => [8081, 8082, 8083].map(port => `http://${host}:${port}`));

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

function iso(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function dose(value: unknown): value is SharedDose {
  if (!record(value) || !keys(value, ['id', 'date', 'time', 'label', 'status'], ['takenAt', 'photo'])
    || !identifier(value.id) || !date(value.date) || !time(value.time) || !name(value.label, 80)
    || (value.status !== 'pending' && value.status !== 'taken')) return false;
  if (value.status === 'pending') return !Object.hasOwn(value, 'takenAt') && !Object.hasOwn(value, 'photo');
  if (!iso(value.takenAt)) return false;
  if (Object.hasOwn(value, 'photo')) {
    const photo = value.photo;
    if (!record(photo) || !keys(photo, ['id', 'capturedAt', 'verified']) || !identifier(photo.id)
      || !iso(photo.capturedAt) || Date.parse(photo.capturedAt) > Date.parse(value.takenAt) || typeof photo.verified !== 'boolean') return false;
  }
  return true;
}

function validVisitUpdate(value: unknown): value is VisitUpdate {
  return record(value) && keys(value, ['connectedAt', 'consentRevision', 'enabled', 'scheduleRevision']) && iso(value.connectedAt)
    && Number.isSafeInteger(value.consentRevision) && Number(value.consentRevision) > 0 && typeof value.enabled === 'boolean'
    && Number.isSafeInteger(value.scheduleRevision) && Number(value.scheduleRevision) >= 0;
}

function snapshotInput(value: unknown, persisted = false): value is PatientSnapshotUpdate {
  if (!record(value) || !keys(value, ['patientName', 'schedule', 'doses', ...(persisted ? ['updatedAt'] : [])], persisted ? ['nextVisit'] : ['nextVisit', 'visitUpdate'])
    || (Object.hasOwn(value, 'nextVisit') && !isSharedVisit(value.nextVisit))
    || (Object.hasOwn(value, 'visitUpdate') && (!validVisitUpdate(value.visitUpdate) || (!value.visitUpdate.enabled && Object.hasOwn(value, 'nextVisit'))))
    || !name(value.patientName) || (persisted && !iso(value.updatedAt)) || !record(value.schedule)
    || !keys(value.schedule, ['frequency', 'times']) || !Array.isArray(value.doses) || value.doses.length > 300
    || !value.doses.every(dose)) return false;
  const counts: Record<string, number> = { once: 1, twice: 2, three: 3 };
  const { frequency, times } = value.schedule;
  if (typeof frequency !== 'string' || !Object.hasOwn(counts, frequency) || !Array.isArray(times)
    || times.length !== counts[frequency] || !times.every(time) || !times.every((item, index) => index === 0 || times[index - 1] < item)) return false;
  if (new Set(value.doses.map(item => item.id)).size !== value.doses.length) return false;
  const photoIds = value.doses.flatMap(item => item.photo ? [item.photo.id] : []);
  if (new Set(photoIds).size !== photoIds.length) return false;
  const dates = value.doses.map(item => Date.parse(`${item.date}T00:00:00.000Z`));
  return dates.length === 0 || Math.max(...dates) - Math.min(...dates) < 90 * 86400000;
}

function updateVisit(patient: Patient, input: PatientSnapshotUpdate, now: Date): { visitUpdate?: VisitUpdate; nextVisit?: SharedVisit } {
  const previous = patient.visitUpdate;
  let visitUpdate = previous;
  let nextVisit = previous?.enabled ? patient.snapshot?.nextVisit : undefined;
  const incoming = input.visitUpdate;
  // Old tabs keep publishing medication heartbeats. Only an explicit preference for
  // this pairing can touch a visit, and an equally recent opt-out takes precedence.
  if (incoming && incoming.connectedAt === patient.caregiver?.connectedAt
    && (!previous || incoming.consentRevision > previous.consentRevision
      || (incoming.consentRevision === previous.consentRevision && (!incoming.enabled || previous.enabled)))) {
    const scheduleRevision = Math.max(incoming.scheduleRevision, previous?.scheduleRevision ?? 0);
    visitUpdate = { ...incoming, scheduleRevision };
    if (!incoming.enabled) nextVisit = undefined;
    else if (incoming.scheduleRevision === scheduleRevision) {
      // An unchanged agenda may advance to its following visit when the former
      // visit expires. A still-future visit needs an actual schedule edit to change.
      const sameAgenda = previous?.enabled && incoming.scheduleRevision === previous.scheduleRevision;
      if (!sameAgenda || !nextVisit || !isUpcomingVisit(nextVisit, now)) nextVisit = input.nextVisit;
    }
  }
  return { ...(visitUpdate && { visitUpdate }), ...(nextVisit && isUpcomingVisit(nextVisit, now) && { nextVisit }) };
}

function clearSharedRecords(patient: Patient): Patient {
  const cleared = { ...patient, caregiver: null, invite: null, snapshot: null, photos: [] };
  delete cleared.visitUpdate;
  return cleared;
}

function photoData(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > PHOTO_REQUEST_LIMIT) return false;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return false;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > PHOTO_BYTES_LIMIT || bytes.toString('base64') !== match[2]) return false;
  if (match[1] === 'jpeg') return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (match[1] === 'png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function hashValue(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function photoIds(patient: Patient): Set<string> { return new Set(patient.snapshot?.doses.flatMap(item => item.photo ? [item.photo.id] : []) ?? []); }

function validPatient(value: unknown): value is Patient {
  if (!record(value) || !keys(value, ['id', 'tokenHash', 'snapshot', 'invite', 'caregiver', 'photos'], ['visitUpdate'])
    || !identifier(value.id) || !hashValue(value.tokenHash)
    || (value.snapshot !== null && !snapshotInput(value.snapshot, true))) return false;
  if (value.invite !== null && (!record(value.invite) || !keys(value.invite, ['codeHash', 'expiresAt'])
    || !hashValue(value.invite.codeHash) || !iso(value.invite.expiresAt))) return false;
  if (value.caregiver !== null && (!record(value.caregiver) || !keys(value.caregiver, ['tokenHash', 'name', 'connectedAt'])
    || !hashValue(value.caregiver.tokenHash) || !name(value.caregiver.name) || !iso(value.caregiver.connectedAt))) return false;
  if (value.invite !== null && value.caregiver !== null) return false;
  if (Object.hasOwn(value, 'visitUpdate') && (!validVisitUpdate(value.visitUpdate) || !record(value.caregiver)
    || value.visitUpdate.connectedAt !== value.caregiver.connectedAt)) return false;
  if (!Array.isArray(value.photos) || value.photos.length > MAX_PHOTOS || !value.photos.every(item => record(item)
    && keys(item, ['id', 'dataUri']) && identifier(item.id) && photoData(item.dataUri))) return false;
  const references = photoIds(value as Patient);
  return value.photos.every(item => references.has(item.id)) && new Set(value.photos.map(item => item.id)).size === value.photos.length;
}

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

function empty(value: unknown): boolean { return record(value) && keys(value, []); }

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
  const replace = (patient: Patient) => save(state.patients.map(item => item.id === patient.id ? patient : item));
  const authenticate = (request: IncomingMessage, role: 'patient' | 'caregiver') => {
    const authorization = request.headers.authorization;
    if (request.rawHeaders.filter((_, index) => index % 2 === 0 && request.rawHeaders[index].toLowerCase() === 'authorization').length !== 1
      || typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) throw new HttpError(401, '기기 인증이 만료되었거나 연결이 해제되었어요. 다시 연결해 주세요.');
    const tokenHash = hash(authorization.slice(7));
    const patient = state.patients.find(item => (role === 'patient' ? item.tokenHash : item.caregiver?.tokenHash) === tokenHash);
    if (!patient) throw new HttpError(401, '기기 인증이 만료되었거나 연결이 해제되었어요. 다시 연결해 주세요.');
    return patient;
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

  const route = async (request: IncomingMessage, path: string, body: unknown): Promise<{ status: number; body: unknown }> => {
    const method = request.method;
    if (path === '/v1/patients' && method === 'POST') {
      if (!empty(body)) throw new HttpError(400, 'Expected an empty object.');
      const token = randomBytes(32).toString('base64url');
      await save([...state.patients, { id: randomUUID(), tokenHash: hash(token), snapshot: null, invite: null, caregiver: null, photos: [] }]);
      return { status: 201, body: { token } };
    }
    if (path === '/v1/caregivers/connect' && method === 'POST') {
      const message = '초대 코드가 올바르지 않거나 만료되었어요. 환자 앱에서 새 코드를 받아 주세요.';
      if (!record(body) || !keys(body, ['code', 'caregiverName']) || typeof body.code !== 'string'
        || !/^\d{8}$/.test(body.code) || !name(body.caregiverName)) throw new HttpError(400, message);
      const codeHash = hash(body.code);
      const patient = state.patients.find(item => item.invite?.codeHash === codeHash && Date.parse(item.invite.expiresAt) > now() && !item.caregiver);
      if (!patient) throw new HttpError(400, message);
      const token = randomBytes(32).toString('base64url');
      await replace({ ...patient, invite: null, caregiver: { tokenHash: hash(token), name: body.caregiverName, connectedAt: new Date(now()).toISOString() } });
      return { status: 201, body: { token, patientName: patient.snapshot?.patientName ?? '환자' } };
    }
    if (path.startsWith('/v1/patient/')) {
      const patient = authenticate(request, 'patient');
      if (path === '/v1/patient/snapshot' && method === 'PUT') {
        if (!snapshotInput(body)) throw new HttpError(400, '공유할 기록의 이름, 일정, 날짜 또는 사진 정보를 확인해 주세요.');
        const updated = new Date(now());
        const { visitUpdate, nextVisit } = updateVisit(patient, body, updated);
        const snapshot: CareSnapshot = { patientName: body.patientName, schedule: body.schedule, doses: body.doses,
          ...(nextVisit && { nextVisit }), updatedAt: updated.toISOString() };
        const next = { ...patient, snapshot, ...(visitUpdate && { visitUpdate }) };
        const references = photoIds(next);
        await replace({ ...next, photos: patient.photos.filter(photo => references.has(photo.id)) });
        return { status: 200, body: snapshot };
      }
      if (path === '/v1/patient/invite' && method === 'POST') {
        if (!empty(body)) throw new HttpError(400, 'Expected an empty object.');
        if (patient.caregiver) throw new HttpError(409, '이미 보호자가 연결되어 있어요. 기존 연결을 해제한 뒤 새로 초대해 주세요.');
        let code: string;
        do { code = String(randomInt(0, 100000000)).padStart(8, '0'); }
        while (state.patients.some(item => item.invite?.codeHash === hash(code)));
        const expiresAt = new Date(now() + ttl).toISOString();
        await replace({ ...patient, invite: { codeHash: hash(code), expiresAt } });
        return { status: 201, body: { code, expiresAt } };
      }
      if (path === '/v1/patient/connection' && method === 'GET') return { status: 200, body: {
        caregiverName: patient.caregiver?.name ?? null, connectedAt: patient.caregiver?.connectedAt ?? null,
        ...(patient.visitUpdate && { visitConsent: { revision: patient.visitUpdate.consentRevision, enabled: patient.visitUpdate.enabled } }),
      } };
      if (path === '/v1/patient/connection' && method === 'DELETE') {
        await replace(clearSharedRecords(patient));
        return { status: 200, body: {} };
      }
      const photo = /^\/v1\/patient\/photos\/([A-Za-z0-9_-]{1,100})$/.exec(path);
      if (photo && method === 'PUT') {
        if (!record(body) || !keys(body, ['dataUri']) || !photoData(body.dataUri)) throw new HttpError(400, '사진은 5 MiB 이하의 JPEG, PNG, WebP 파일이어야 해요.');
        if (!photoIds(patient).has(photo[1])) throw new HttpError(404, '공유된 사진을 찾을 수 없어요.');
        await replace({ ...patient, photos: [...patient.photos.filter(item => item.id !== photo[1]), { id: photo[1], dataUri: body.dataUri }].slice(-MAX_PHOTOS) });
        return { status: 200, body: {} };
      }
    }
    if (path.startsWith('/v1/caregiver/')) {
      const patient = authenticate(request, 'caregiver');
      const caregiver = patient.caregiver!;
      if (path === '/v1/caregiver/snapshot' && method === 'GET') {
        const snapshot = patient.snapshot && { ...patient.snapshot };
        if (snapshot?.nextVisit && (!patient.visitUpdate?.enabled || !isUpcomingVisit(snapshot.nextVisit, new Date(now())))) delete snapshot.nextVisit;
        return { status: 200, body: { snapshot, connectedAt: caregiver.connectedAt, caregiverName: caregiver.name } };
      }
      if (path === '/v1/caregiver/connection' && method === 'DELETE') {
        await replace(clearSharedRecords(patient));
        return { status: 200, body: {} };
      }
      const photo = /^\/v1\/caregiver\/photos\/([A-Za-z0-9_-]{1,100})$/.exec(path);
      if (photo && method === 'GET') {
        const stored = photoIds(patient).has(photo[1]) && patient.photos.find(item => item.id === photo[1]);
        if (!stored) throw new HttpError(404, '공유된 사진을 찾을 수 없어요.');
        return { status: 200, body: { dataUri: stored.dataUri } };
      }
    }
    throw new HttpError(404, 'Route not found.');
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
      if (url.pathname.startsWith('/v1/patient/')) authenticate(request, 'patient');
      if (url.pathname.startsWith('/v1/caregiver/')) authenticate(request, 'caregiver');
      if (queued >= 50) throw new HttpError(503, '서버가 사용 중이에요. 잠시 후 다시 시도해 주세요.');
      queued += 1;
      try {
        let body: unknown;
        if (request.method === 'POST' || request.method === 'PUT') body = await readJson(request, /^\/v1\/patient\/photos\//.test(url.pathname) ? PHOTO_REQUEST_LIMIT : JSON_LIMIT);
        else if (request.headers['transfer-encoding'] || Number(request.headers['content-length'] ?? 0) > 0) throw new HttpError(400, 'This request does not accept a body.');
        const operation = queue.then(() => route(request, url.pathname, body));
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
