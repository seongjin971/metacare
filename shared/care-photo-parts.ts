import type { PhotoTransfer } from './care-types.ts';

// Three MiB encodes to 4,194,304 base64 bytes, leaving room for JSON under the 4.5 MB function limit.
export const PHOTO_PART_BYTES = 3 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/** A multi-megabyte part can take far longer than an ordinary JSON request on a mobile uplink. */
export const PHOTO_TRANSFER_TIMEOUT_MS = 60_000;
const PART_CHARACTERS = PHOTO_PART_BYTES / 3 * 4;
export type PhotoMime = 'image/jpeg' | 'image/png' | 'image/webp';
type PhotoPart = { mime: PhotoMime; bytes: number; base64: string; version: string };
type PhotoRequest = <T>(path: string, options: { token: string; method?: string; body?: unknown; timeoutMs?: number }) => Promise<T>;
const timeoutMs = PHOTO_TRANSFER_TIMEOUT_MS;

/** The stored file can never be shared, so retrying it cannot succeed. */
export class PhotoTooLargeError extends Error {
  constructor() { super('5 MiB 이하의 사진만 전송할 수 있어요.'); this.name = 'PhotoTooLargeError'; }
}

export function isPhotoMime(value: unknown): value is PhotoMime {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp';
}

export function isPhotoSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_PHOTO_BYTES;
}

export function isPhotoVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}

function base64Bytes(data: string) {
  return data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
}

function checkPart(part: PhotoPart, bytes: number) {
  if (!part || typeof part.base64 !== 'string' || part.base64.length !== Math.ceil(bytes / 3) * 4
    || base64Bytes(part.base64) !== bytes || !/^[A-Za-z0-9+/]+={0,2}$/.test(part.base64)) {
    throw new Error('사진 조각의 크기나 형식이 올바르지 않아요.');
  }
}

export async function uploadSharedPhoto(request: PhotoRequest, id: string, token: string, dataUri: string,
  transfer: PhotoTransfer | undefined, active: () => boolean): Promise<boolean> {
  const path = `/v1/patient/photos/${encodeURIComponent(id)}`;
  if (!active()) return false;
  if (transfer !== 'parts-v1') {
    await request(path, { method: 'PUT', token, body: { dataUri }, timeoutMs });
    return active();
  }
  const header = /^data:(image\/(?:jpeg|png|webp));base64,/.exec(dataUri);
  if (!header) throw new Error('사진 형식이 올바르지 않아요.');
  const base64 = dataUri.slice(header[0].length);
  const bytes = base64Bytes(base64);
  if (base64.length % 4 !== 0 || bytes <= 0) throw new Error('사진 형식이 올바르지 않아요.');
  if (!isPhotoSize(bytes)) throw new PhotoTooLargeError();
  const first = await request<{ uploadId: string }>(`${path}/parts/0`, {
    method: 'PUT', token, body: { mime: header[1], bytes, base64: base64.slice(0, PART_CHARACTERS) }, timeoutMs,
  });
  if (!active()) return false;
  if (!isPhotoVersion(first?.uploadId)) throw new Error('사진 저장 응답을 확인할 수 없어요.');
  if (bytes > PHOTO_PART_BYTES) {
    await request(`${path}/parts/1`, { method: 'PUT', token, body: { uploadId: first.uploadId, base64: base64.slice(PART_CHARACTERS) }, timeoutMs });
  }
  return active();
}

export async function downloadSharedPhoto(request: PhotoRequest, id: string, token: string, transfer: PhotoTransfer | undefined,
  active: () => boolean): Promise<string | null> {
  const path = `/v1/caregiver/photos/${encodeURIComponent(id)}`;
  if (!active()) return null;
  if (transfer !== 'parts-v1') {
    const response = await request<{ dataUri: string }>(path, { token, timeoutMs });
    if (!active()) return null;
    if (typeof response?.dataUri !== 'string' || !/^data:image\/(?:jpeg|png|webp);base64,/.test(response.dataUri)) throw new Error('사진 형식을 읽을 수 없어요.');
    return response.dataUri;
  }
  const first = await request<PhotoPart>(`${path}/parts/0`, { token, timeoutMs });
  if (!active()) return null;
  if (!first || !isPhotoSize(first.bytes) || !isPhotoMime(first.mime) || !isPhotoVersion(first.version)) throw new Error('사진 정보를 확인할 수 없어요.');
  checkPart(first, Math.min(first.bytes, PHOTO_PART_BYTES));
  let uri = `data:${first.mime};base64,${first.base64}`;
  if (first.bytes > PHOTO_PART_BYTES) {
    const second = await request<PhotoPart>(`${path}/parts/1/${first.version}`, { token, timeoutMs });
    if (!active()) return null;
    if (!second || second.version !== first.version || second.bytes !== first.bytes || second.mime !== first.mime) throw new Error('사진이 변경됐어요. 다시 열어 주세요.');
    checkPart(second, first.bytes - PHOTO_PART_BYTES);
    uri += second.base64;
  }
  return uri;
}
