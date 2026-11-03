import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { HttpError } from './care-errors.ts';
import { validTimeZone } from './overdue.ts';
import type { CareSnapshot, PatientSnapshotUpdate, SharedDose, SharedVisit, VisitUpdate } from '../shared/care-types.ts';
import { isCareName as name, isCareDate as date, isCareTime as time, isSharedVisit, isUpcomingVisit } from '../shared/care-visit.ts';

type StoredPhoto = { id: string; dataUri: string };
export type Patient = {
  id: string;
  tokenHash: string;
  snapshot: CareSnapshot | null;
  sharingRevoked?: boolean;
  visitUpdate?: VisitUpdate;
  invite: { codeHash: string; expiresAt: string } | null;
  caregiver: { tokenHash: string; name: string; connectedAt: string } | null;
  photos: StoredPhoto[];
};
const PHOTO_REQUEST_LIMIT = 7 * 1024 * 1024;
const PHOTO_BYTES_LIMIT = 5 * 1024 * 1024;
export const MAX_PHOTOS = 30;

export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
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
  if (!record(value) || !keys(value, ['patientName', 'schedule', 'doses', ...(persisted ? ['updatedAt'] : [])], persisted ? ['nextVisit', 'timeZone'] : ['nextVisit', 'visitUpdate', 'timeZone'])
    || (Object.hasOwn(value, 'timeZone') && !validTimeZone(value.timeZone))
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

function updateVisit(patient: Patient, input: PatientSnapshotUpdate, now: Date, isUpcoming: typeof isUpcomingVisit): { visitUpdate?: VisitUpdate; nextVisit?: SharedVisit } {
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
      if (!sameAgenda || !nextVisit || !isUpcoming(nextVisit, now)) nextVisit = input.nextVisit;
    }
  }
  return { ...(visitUpdate && { visitUpdate }), ...(nextVisit && isUpcoming(nextVisit, now) && { nextVisit }) };
}

function clearSharedRecords(patient: Patient): Patient {
  const cleared = { ...patient, caregiver: null, invite: null, snapshot: null, photos: [], sharingRevoked: true };
  delete cleared.visitUpdate;
  return cleared;
}

// Older saved identities without any remaining shared state may already have been unlinked.
function sharingRevoked(patient: Patient): boolean {
  return patient.sharingRevoked ?? (!patient.invite && !patient.caregiver && !patient.snapshot);
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

export function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function hashValue(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
export function photoIds(patient: Patient): Set<string> { return new Set(patient.snapshot?.doses.flatMap(item => item.photo ? [item.photo.id] : []) ?? []); }

export function validPatient(value: unknown): value is Patient {
  if (!record(value) || !keys(value, ['id', 'tokenHash', 'snapshot', 'invite', 'caregiver', 'photos'], ['visitUpdate', 'sharingRevoked'])
    || (value.sharingRevoked !== undefined && typeof value.sharingRevoked !== 'boolean')
    || (value.sharingRevoked === true && (value.snapshot !== null || value.caregiver !== null || value.invite !== null))
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

function empty(value: unknown): boolean { return record(value) && keys(value, []); }

export type Role = 'patient' | 'caregiver';
export type CareResult = { status: number; body: unknown };
type MaybePromise<T> = T | Promise<T>;
/** A cloud transaction holds the family row lock until the response is ready to commit. */
export type CareStore = {
  byToken(role: Role, tokenHash: string): MaybePromise<Patient | undefined>;
  byInvite(codeHash: string): MaybePromise<Patient | undefined>;
  inviteExists(codeHash: string): MaybePromise<boolean>;
  create(patient: Patient): Promise<void>;
  replace(patient: Patient): Promise<void>;
  alerts?(patient: Patient, method: string, body: unknown, nowMs: number): Promise<CareResult>;
  photoParts?(patientId: string, photoId: string, parts: string[], method: string, body: unknown, role: Role): Promise<CareResult>;
};

export function tokenDigest(authorization: string | undefined): string {
  if (!authorization || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) {
    throw new HttpError(401, '기기 인증이 만료되었거나 연결이 해제되었어요. 다시 연결해 주세요.');
  }
  return hash(authorization.slice(7));
}

async function authenticate(store: CareStore, authorization: string | undefined, role: Role): Promise<Patient> {
  const patient = await store.byToken(role, tokenDigest(authorization));
  if (!patient) throw new HttpError(401, '기기 인증이 만료되었거나 연결이 해제되었어요. 다시 연결해 주세요.');
  return patient;
}

async function photoRoute(store: CareStore, patient: Patient, role: Role, path: string, method: string, body: unknown): Promise<CareResult> {
  const [, , , , id, ...parts] = path.split('/');
  if (!identifier(id) || !patient.caregiver || !photoIds(patient).has(id) || !store.photoParts) {
    throw new HttpError(404, '공유된 사진을 찾을 수 없어요.');
  }
  return store.photoParts(patient.id, id, parts, method, body, role);
}

export async function routeCare(store: CareStore, method: string, path: string, authorization: string | undefined,
  body: unknown, now: () => number, ttl: number, isUpcoming: typeof isUpcomingVisit = isUpcomingVisit): Promise<CareResult> {
  if (path === '/v1/patients' && method === 'POST') {
    if (!empty(body)) throw new HttpError(400, 'Expected an empty object.');
    const token = randomBytes(32).toString('base64url');
    await store.create({ id: randomUUID(), tokenHash: hash(token), snapshot: null, invite: null, caregiver: null, photos: [], sharingRevoked: false });
    return { status: 201, body: { token } };
  }
  if (path === '/v1/caregivers/connect' && method === 'POST') {
    const message = '초대 코드가 올바르지 않거나 만료되었어요. 환자 앱에서 새 코드를 받아 주세요.';
    if (!record(body) || !keys(body, ['code', 'caregiverName']) || typeof body.code !== 'string'
      || !/^\d{8}$/.test(body.code) || !name(body.caregiverName)) throw new HttpError(400, message);
    const codeHash = hash(body.code);
    const patient = await store.byInvite(codeHash);
    if (!patient?.invite || Date.parse(patient.invite.expiresAt) <= now() || patient.caregiver) throw new HttpError(400, message);
    const token = randomBytes(32).toString('base64url');
    await store.replace({ ...patient, invite: null, caregiver: { tokenHash: hash(token), name: body.caregiverName, connectedAt: new Date(now()).toISOString() } });
    return { status: 201, body: { token, patientName: patient.snapshot?.patientName ?? '환자' } };
  }
  if (path.startsWith('/v1/patient/')) {
    const patient = await authenticate(store, authorization, 'patient');
    if (path === '/v1/patient/snapshot' && method === 'PUT') {
      if (!snapshotInput(body) || (store.photoParts && body.doses.filter(item => item.photo).length > MAX_PHOTOS)) throw new HttpError(400, '공유할 기록의 이름, 일정, 날짜 또는 사진 정보를 확인해 주세요.');
      const updated = new Date(now());
      // Legacy clients publish before issuing a fresh invite. Acknowledge the upload
      // without retaining any health data until explicit re-consent via a new invite.
      if (sharingRevoked(patient)) return { status: 200, body: { updatedAt: updated.toISOString(), sharingRevoked: true } };
      const { visitUpdate, nextVisit } = updateVisit(patient, body, updated, isUpcoming);
      const timeZone = body.timeZone ?? patient.snapshot?.timeZone;
      const snapshot: CareSnapshot = { patientName: body.patientName, schedule: body.schedule, doses: body.doses, ...(timeZone && { timeZone }),
        ...(nextVisit && { nextVisit }), updatedAt: updated.toISOString() };
      const next = { ...patient, snapshot, ...(visitUpdate && { visitUpdate }) };
      const references = photoIds(next);
      await store.replace({ ...next, photos: patient.photos.filter(photo => references.has(photo.id)) });
      return { status: 200, body: snapshot };
    }
    if (path === '/v1/patient/invite' && method === 'POST') {
      if (!empty(body)) throw new HttpError(400, 'Expected an empty object.');
      if (patient.caregiver) throw new HttpError(409, '이미 보호자가 연결되어 있어요. 기존 연결을 해제한 뒤 새로 초대해 주세요.');
      let code: string;
      do { code = String(randomInt(0, 100000000)).padStart(8, '0'); }
      while (await store.inviteExists(hash(code)));
      const expiresAt = new Date(now() + ttl).toISOString();
      await store.replace({ ...patient, sharingRevoked: false, invite: { codeHash: hash(code), expiresAt } });
      return { status: 201, body: { code, expiresAt } };
    }
    if (path === '/v1/patient/connection' && method === 'GET') return { status: 200, body: {
      ...(store.photoParts && { photoTransfer: 'parts-v1' }),
      caregiverName: patient.caregiver?.name ?? null, connectedAt: patient.caregiver?.connectedAt ?? null,
      ...(sharingRevoked(patient) && { sharingRevoked: true }),
      ...(patient.visitUpdate && { visitConsent: { revision: patient.visitUpdate.consentRevision, enabled: patient.visitUpdate.enabled } }),
    } };
    if (path === '/v1/patient/connection' && method === 'DELETE') {
      await store.replace(clearSharedRecords(patient));
      return { status: 200, body: {} };
    }
    if (store.photoParts && path.startsWith('/v1/patient/photos/')) return await photoRoute(store, patient, 'patient', path, method, body);
    const photo = /^\/v1\/patient\/photos\/([A-Za-z0-9_-]{1,100})$/.exec(path);
    if (photo && method === 'PUT') {
      if (!record(body) || !keys(body, ['dataUri']) || !photoData(body.dataUri)) throw new HttpError(400, '사진은 5 MiB 이하의 JPEG, PNG, WebP 파일이어야 해요.');
      if (!photoIds(patient).has(photo[1])) throw new HttpError(404, '공유된 사진을 찾을 수 없어요.');
      await store.replace({ ...patient, photos: [...patient.photos.filter(item => item.id !== photo[1]), { id: photo[1], dataUri: body.dataUri }].slice(-MAX_PHOTOS) });
      return { status: 200, body: {} };
    }
  }
  if (path.startsWith('/v1/caregiver/')) {
    const patient = await authenticate(store, authorization, 'caregiver');
    const caregiver = patient.caregiver!;
    if (path === '/v1/caregiver/alerts' && store.alerts && (method === 'GET' || method === 'PUT')) {
      return await store.alerts(patient, method, body, now());
    }
    if (path === '/v1/caregiver/snapshot' && method === 'GET') {
      const snapshot = patient.snapshot && { ...patient.snapshot };
      if (snapshot?.nextVisit && (!patient.visitUpdate?.enabled || !isUpcoming(snapshot.nextVisit, new Date(now())))) delete snapshot.nextVisit;
      return { status: 200, body: { snapshot, ...(store.photoParts && { photoTransfer: 'parts-v1' }), connectedAt: caregiver.connectedAt, caregiverName: caregiver.name } };
    }
    if (path === '/v1/caregiver/connection' && method === 'DELETE') {
      await store.replace(clearSharedRecords(patient));
      return { status: 200, body: {} };
    }
    if (store.photoParts && path.startsWith('/v1/caregiver/photos/')) return await photoRoute(store, patient, 'caregiver', path, method, body);
    const photo = /^\/v1\/caregiver\/photos\/([A-Za-z0-9_-]{1,100})$/.exec(path);
    if (photo && method === 'GET') {
      const stored = photoIds(patient).has(photo[1]) && patient.photos.find(item => item.id === photo[1]);
      if (!stored) throw new HttpError(404, '공유된 사진을 찾을 수 없어요.');
      return { status: 200, body: { dataUri: stored.dataUri } };
    }
  }
  throw new HttpError(404, 'Route not found.');
}
