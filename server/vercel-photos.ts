import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { isPhotoMime, isPhotoSize, isPhotoVersion, MAX_PHOTO_BYTES, PHOTO_PART_BYTES, type PhotoMime } from '../shared/care-photo-parts.ts';
import { HttpError } from './care-errors.ts';

type PhotoResult = { status: number; body: unknown };
type PhotoRow = { mime: PhotoMime; bytes: number; version: string; pixels: Buffer };
const unavailable = () => new HttpError(404, '공유된 사진을 찾을 수 없어요.');
const invalid = () => new HttpError(400, '사진은 5 MiB 이하의 JPEG, PNG, WebP 파일이어야 해요.');

function fields(value: unknown, names: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length
    && names.every(name => Object.hasOwn(value, name));
}

function decode(base64: unknown, bytes: number): Buffer {
  if (typeof base64 !== 'string' || base64.length !== Math.ceil(bytes / 3) * 4) throw invalid();
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length !== bytes || buffer.toString('base64') !== base64) throw invalid();
  return buffer;
}

function matchesMime(mime: PhotoMime, pixels: Buffer) {
  if (mime === 'image/jpeg') return pixels.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (mime === 'image/png') return pixels.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]));
  return pixels.subarray(0, 4).equals(Buffer.from('RIFF')) && pixels.subarray(8, 12).equals(Buffer.from('WEBP'));
}

const replacePhoto = `ON CONFLICT (patient_id, photo_id) DO UPDATE
  SET mime = EXCLUDED.mime, version = EXCLUDED.version, pixels = EXCLUDED.pixels`;
const clearPartial = 'DELETE FROM metacare_photo_uploads WHERE patient_id = $1 AND photo_id = $2';

/** Caller authenticates the role, checks the snapshot reference and locks the family row in this transaction. */
export async function routeVercelPhoto(db: PoolClient, patientId: string, photoId: string, parts: string[], method: string,
  body: unknown, role: 'patient' | 'caregiver'): Promise<PhotoResult> {
  if (parts[0] !== 'parts') throw unavailable();
  if (role === 'patient' && method === 'PUT' && parts.length === 2) {
    if (parts[1] === '0') return uploadFirst(db, patientId, photoId, body);
    if (parts[1] === '1') return uploadLast(db, patientId, photoId, body);
  }
  if (role === 'caregiver' && method === 'GET') {
    if (parts.length === 2 && parts[1] === '0') return readPart(db, patientId, photoId);
    if (parts.length === 3 && parts[1] === '1' && isPhotoVersion(parts[2])) return readPart(db, patientId, photoId, parts[2]);
  }
  throw unavailable();
}

async function uploadFirst(db: PoolClient, patientId: string, photoId: string, body: unknown): Promise<PhotoResult> {
  if (!fields(body, ['mime', 'bytes', 'base64']) || !isPhotoMime(body.mime) || !isPhotoSize(body.bytes)) throw invalid();
  const pixels = decode(body.base64, Math.min(body.bytes, PHOTO_PART_BYTES));
  if (!matchesMime(body.mime, pixels)) throw invalid();
  const version = randomBytes(16).toString('hex');
  if (body.bytes <= PHOTO_PART_BYTES) {
    await db.query(`INSERT INTO metacare_photos (patient_id, photo_id, mime, version, pixels)
      VALUES ($1,$2,$3,$4,$5) ${replacePhoto}`, [patientId, photoId, body.mime, version, pixels]);
    await db.query(clearPartial, [patientId, photoId]);
  } else {
    await db.query(`INSERT INTO metacare_photo_uploads (patient_id, photo_id, mime, upload_id, expected_bytes, first_part, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,now() + interval '15 minutes') ON CONFLICT (patient_id, photo_id) DO UPDATE SET
      mime=EXCLUDED.mime, upload_id=EXCLUDED.upload_id, expected_bytes=EXCLUDED.expected_bytes,
      first_part=EXCLUDED.first_part, expires_at=EXCLUDED.expires_at`,
    [patientId, photoId, body.mime, version, body.bytes, pixels]);
  }
  return { status: 200, body: { uploadId: version } };
}

async function uploadLast(db: PoolClient, patientId: string, photoId: string, body: unknown): Promise<PhotoResult> {
  if (!fields(body, ['uploadId', 'base64']) || !isPhotoVersion(body.uploadId) || typeof body.base64 !== 'string'
    || body.base64.length > Math.ceil((MAX_PHOTO_BYTES - PHOTO_PART_BYTES) / 3) * 4) throw invalid();
  const key = [patientId, photoId, body.uploadId];
  const pending = await db.query<{ expected_bytes: number }>(`SELECT expected_bytes FROM metacare_photo_uploads
    WHERE patient_id=$1 AND photo_id=$2 AND upload_id=$3 AND expires_at > now()`, key);
  if (!pending.rows[0]) {
    // A successful response can be lost. A repeated final part is accepted only if it matches the committed bytes.
    const existing = await db.query<{ tail: Buffer }>(`SELECT substring(pixels FROM $4::integer) AS tail FROM metacare_photos
      WHERE patient_id=$1 AND photo_id=$2 AND version=$3 AND octet_length(pixels) >= $4`, [...key, PHOTO_PART_BYTES + 1]);
    if (!existing.rows[0] || Buffer.from(existing.rows[0].tail).toString('base64') !== body.base64) {
      throw new HttpError(409, '사진 전송이 만료되었거나 변경됐어요. 다시 전송해 주세요.');
    }
    return { status: 200, body: {} };
  }
  const pixels = decode(body.base64, pending.rows[0].expected_bytes - PHOTO_PART_BYTES);
  await db.query(`INSERT INTO metacare_photos (patient_id, photo_id, mime, version, pixels)
    SELECT patient_id, photo_id, mime, upload_id, first_part || $4::bytea
    FROM metacare_photo_uploads WHERE patient_id=$1 AND photo_id=$2 AND upload_id=$3 ${replacePhoto}`, [...key, pixels]);
  await db.query(clearPartial, [patientId, photoId]);
  return { status: 200, body: {} };
}

async function readPart(db: PoolClient, patientId: string, photoId: string, version?: string): Promise<PhotoResult> {
  const start = version ? PHOTO_PART_BYTES + 1 : 1;
  const data = await db.query<PhotoRow>(`SELECT mime, octet_length(pixels) AS bytes, version,
    substring(pixels FROM $3::integer FOR $4::integer) AS pixels FROM metacare_photos
    WHERE patient_id=$1 AND photo_id=$2 AND octet_length(pixels) >= $3 AND ($5::text IS NULL OR version=$5)`,
  [patientId, photoId, start, PHOTO_PART_BYTES, version ?? null]);
  const row = data.rows[0];
  if (!row) throw unavailable();
  return { status: 200, body: { mime: row.mime, bytes: row.bytes, version: row.version, base64: Buffer.from(row.pixels).toString('base64') } };
}

export async function pruneVercelPhotos(db: PoolClient, patientId: string, photoIds: string[]): Promise<void> {
  const values = [patientId, photoIds];
  await db.query('DELETE FROM metacare_photos WHERE patient_id=$1 AND NOT (photo_id = ANY($2::text[]))', values);
  await db.query(`DELETE FROM metacare_photo_uploads WHERE patient_id=$1 AND
    (expires_at <= now() OR NOT (photo_id = ANY($2::text[])))`, values);
}
