import type { DosePhoto } from './dose-photo';
import { loadDosePhotoUri } from './dose-photo-storage';

const MAX_BYTES = 5 * 1024 * 1024;

export async function readPhotoForSharing(photo: DosePhoto): Promise<string> {
  const dataUri = await loadDosePhotoUri(photo);
  const match = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUri);
  const base64 = match?.[1];
  const bytes = base64 ? base64.length * 3 / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0) : 0;
  if (!base64 || base64.length % 4 !== 0 || bytes <= 0 || bytes > MAX_BYTES) {
    throw new Error('5MB 이하의 사진만 공유할 수 있어요.');
  }
  return dataUri;
}
