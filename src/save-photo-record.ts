import type { DosePhoto } from './dose-photo.ts';

/** Store pixels first; attach them to a durable record only if that commit succeeds. */
export async function savePhotoRecord<T>(capture: T, dependencies: {
  savePhoto: (capture: T) => Promise<DosePhoto>;
  commitRecord: (photo: DosePhoto) => Promise<boolean>;
  removePhoto: (photo: DosePhoto) => Promise<void>;
  canCommit?: () => boolean;
}): Promise<boolean> {
  const photo = await dependencies.savePhoto(capture);
  let committed = false;
  try {
    if (dependencies.canCommit && !dependencies.canCommit()) return false;
    committed = await dependencies.commitRecord(photo);
    return committed;
  } finally {
    if (!committed) {
      // Cleanup failure must not turn an unsuccessful record into a success.
      await dependencies.removePhoto(photo).catch(() => undefined);
    }
  }
}
