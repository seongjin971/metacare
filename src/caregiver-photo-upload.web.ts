import type { DosePhoto } from './dose-photo';
import { loadDosePhotoUri } from './dose-photo-storage';
import { MAX_PHOTO_BYTES, PhotoTooLargeError } from '../shared/care-photo-parts';

export async function readPhotoForSharing(photo: DosePhoto): Promise<string> {
  const dataUri = await loadDosePhotoUri(photo);
  const match = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUri);
  const base64 = match?.[1];
  const bytes = base64 ? base64.length * 3 / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0) : 0;
  if (!base64 || base64.length % 4 !== 0 || bytes <= 0) throw new Error('저장된 사진 형식을 확인할 수 없어요.');
  if (bytes > MAX_PHOTO_BYTES) throw new PhotoTooLargeError();
  return dataUri;
}
