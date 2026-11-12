import { Directory, File, Paths } from 'expo-file-system';
import { MAX_PHOTO_BYTES } from '../shared/care-photo-parts';
import { normalizeDosePhoto, normalizePhotoVerification, type DosePhoto, type PhotoVerification } from './dose-photo';

export type DosePhotoCapture = { uri: string; capturedAt: string; width: number; height: number; verification?: PhotoVerification };

function directory() {
  return new Directory(Paths.document, 'dose-photos');
}

function photoFile(photo: DosePhoto) {
  const checked = normalizeDosePhoto(photo);
  return new File(directory(), `${checked.id}.jpeg`);
}

/** Copy the camera's temporary file before committing its reference to a dose. */
export async function saveDosePhoto(capture: DosePhotoCapture): Promise<DosePhoto> {
  const photo = normalizeDosePhoto({
    id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`,
    capturedAt: capture.capturedAt,
    width: capture.width,
    height: capture.height,
    ...(capture.verification && { verification: normalizePhotoVerification(capture.verification, capture.capturedAt) }),
  });
  if (typeof capture.uri !== 'string' || !capture.uri.startsWith('file://')) {
    throw new Error('촬영한 사진을 찾을 수 없어요. 다시 촬영해 주세요.');
  }
  const source = new File(capture.uri);
  // Accept only temporary app camera files, never a network URL or an arbitrary device file.
  if (!source.uri.startsWith(`${Paths.cache.uri.replace(/\/$/, '')}/`) || !source.exists || source.size <= 0) {
    throw new Error('촬영한 사진을 찾을 수 없어요. 다시 촬영해 주세요.');
  }
  if (source.size > MAX_PHOTO_BYTES) throw new Error('사진 용량이 5MB를 넘어요. 약봉투 가까이에서 다시 촬영해 주세요.');
  const target = photoFile(photo);
  let copyStarted = false;
  try {
    directory().create({ intermediates: true, idempotent: true });
    if (target.exists) throw new Error('사진 파일이 이미 존재해요. 다시 시도해 주세요.');
    copyStarted = true;
    await source.copy(target);
    if (!target.exists || target.size <= 0 || target.size !== source.size) {
      throw new Error('사진 저장이 완료되지 않았어요. 다시 시도해 주세요.');
    }
    return photo;
  } catch {
    // Remove only this attempt's managed destination; retain the camera preview for retry.
    try { if (copyStarted && target.exists) target.delete(); } catch { /* Best-effort cleanup after a failed copy. */ }
    throw new Error('사진을 기기에 저장하지 못했어요. 저장 공간을 확인하고 다시 시도해 주세요.');
  }
}

export async function loadDosePhotoUri(photo: DosePhoto): Promise<string> {
  const file = photoFile(photo);
  if (!file.exists || file.size <= 0) throw new Error('저장된 사진을 찾을 수 없어요.');
  return file.uri;
}

/** The validated ID can only address one file in this app's managed photo directory. */
export async function removeDosePhoto(photo: DosePhoto): Promise<void> {
  const file = photoFile(photo);
  if (file.exists) file.delete();
}
