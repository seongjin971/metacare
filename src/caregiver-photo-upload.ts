import { File } from 'expo-file-system';
import { MAX_PHOTO_BYTES, PhotoTooLargeError } from '../shared/care-photo-parts';
import type { DosePhoto } from './dose-photo';
import { loadDosePhotoUri } from './dose-photo-storage';

/** Called only by the explicitly consented sharing session. */
export async function readPhotoForSharing(photo: DosePhoto): Promise<string> {
  const file = new File(await loadDosePhotoUri(photo));
  if (!file.exists || file.size <= 0) throw new Error('저장된 사진을 찾을 수 없어요.');
  if (file.size > MAX_PHOTO_BYTES) throw new PhotoTooLargeError();
  return `data:image/jpeg;base64,${await file.base64()}`;
}
