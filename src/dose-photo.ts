export type PhotoVerification = { method: 'medicine-pouch-text-v1'; checkedAt: string };

/** A local photo reference. OCR text is never stored with the record. */
export type DosePhoto = {
  id: string;
  capturedAt: string;
  width: number;
  height: number;
  verification?: PhotoVerification;
};

export function normalizePhotoVerification(value: unknown, capturedAt: string): PhotoVerification {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('약봉투 사진 확인이 필요해요. 다시 촬영해 주세요.');
  const check = value as Record<string, unknown>;
  if (check.method !== 'medicine-pouch-text-v1' || typeof check.checkedAt !== 'string'
    || !Number.isFinite(Date.parse(check.checkedAt)) || new Date(check.checkedAt).toISOString() !== check.checkedAt
    || Date.parse(check.checkedAt) < Date.parse(capturedAt)) {
    throw new Error('사진 확인 정보를 읽지 못했어요. 다시 촬영해 주세요.');
  }
  return { method: check.method, checkedAt: check.checkedAt };
}

export function normalizeDosePhoto(value: unknown): DosePhoto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('사진을 촬영한 뒤 복약을 기록해 주세요.');
  const photo = value as Record<string, unknown>;
  if (typeof photo.id !== 'string' || !/^photo-[A-Za-z0-9-]{1,120}$/.test(photo.id)) {
    throw new Error('촬영한 사진을 확인할 수 없어요. 다시 촬영해 주세요.');
  }
  if (typeof photo.capturedAt !== 'string' || !Number.isFinite(Date.parse(photo.capturedAt))
    || new Date(photo.capturedAt).toISOString() !== photo.capturedAt) {
    throw new Error('사진 촬영 시간을 확인할 수 없어요. 다시 촬영해 주세요.');
  }
  if (typeof photo.width !== 'number' || typeof photo.height !== 'number'
    || !Number.isInteger(photo.width) || !Number.isInteger(photo.height)
    || photo.width <= 0 || photo.height <= 0 || photo.width > 20000 || photo.height > 20000) {
    throw new Error('촬영한 사진이 올바르지 않아요. 다시 촬영해 주세요.');
  }
  return {
    id: photo.id, capturedAt: photo.capturedAt, width: photo.width, height: photo.height,
    ...(photo.verification === undefined ? {} : { verification: normalizePhotoVerification(photo.verification, photo.capturedAt) }),
  };
}

export function isDosePhoto(value: unknown): value is DosePhoto {
  try { normalizeDosePhoto(value); return true; } catch { return false; }
}
