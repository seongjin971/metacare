import { File } from 'expo-file-system';
import type { DosePhoto } from './dose-photo';
import { loadDosePhotoUri } from './dose-photo-storage';

const MAX_BYTES = 5 * 1024 * 1024;

/** Called only by the explicitly consented sharing session. */
export async function readPhotoForSharing(photo: DosePhoto): Promise<string> {
  const file = new File(await loadDosePhotoUri(photo));
  if (!file.exists || file.size <= 0 || file.size > MAX_BYTES) {
    throw new Error('5MB 이하의 사진만 공유할 수 있어요.');
  }
  return `data:image/jpeg;base64,${await file.base64()}`;
}
