import { normalizeDosePhoto, normalizePhotoVerification, type DosePhoto, type PhotoVerification } from './dose-photo';

export type DosePhotoCapture = { uri: string; capturedAt: string; width: number; height: number; verification: PhotoVerification };
const DATABASE_NAME = 'metacare-dose-photos';
const STORE_NAME = 'photos';
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('이 브라우저에서는 사진을 저장할 수 없어요. 다른 브라우저나 앱에서 다시 시도해 주세요.'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    let abandoned = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onerror = () => reject(new Error('사진 보관함을 열지 못했어요. 브라우저 저장 공간을 확인해 주세요.'));
    request.onblocked = () => {
      abandoned = true;
      reject(new Error('사진 보관함을 사용 중이에요. 다른 앱 탭을 닫고 다시 시도해 주세요.'));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (abandoned) { database.close(); return; }
      database.onversionchange = () => { database.close(); databasePromise = undefined; };
      resolve(database);
    };
  });
  databasePromise = opening.catch(error => { databasePromise = undefined; throw error; });
  return databasePromise;
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    // Resolving only on commit prevents the dose from being marked after a failed write.
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(new Error('사진을 저장하거나 불러오지 못했어요. 브라우저 저장 공간을 확인해 주세요.'));
    transaction.onabort = () => reject(new Error('사진 저장이 중단됐어요. 다시 시도해 주세요.'));
  });
}

function captureBlob(uri: string): Blob {
  if (typeof uri !== 'string' || uri.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 100) {
    throw new Error('촬영한 사진의 용량을 확인해 주세요.');
  }
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(uri);
  if (!match || match[2].length % 4 !== 0) throw new Error('촬영한 사진이 올바르지 않아요. 다시 촬영해 주세요.');
  let binary: string;
  try { binary = atob(match[2]); } catch { throw new Error('촬영한 사진을 읽지 못했어요. 다시 촬영해 주세요.'); }
  if (!binary.length || binary.length > MAX_PHOTO_BYTES) throw new Error('촬영한 사진의 용량을 확인해 주세요.');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  if ((match[1] === 'image/jpeg' && !jpeg) || (match[1] === 'image/png' && !png)) {
    throw new Error('촬영한 사진이 올바르지 않아요. 다시 촬영해 주세요.');
  }
  return new Blob([bytes], { type: match[1] });
}

function validateImage(uri: string, photo: DosePhoto): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const matches = image.naturalWidth === photo.width && image.naturalHeight === photo.height;
      image.onload = null;
      image.onerror = null;
      if (matches) resolve();
      else reject(new Error('사진 정보를 확인할 수 없어요. 다시 촬영해 주세요.'));
    };
    image.onerror = () => {
      image.onload = null;
      image.onerror = null;
      reject(new Error('촬영한 사진을 읽지 못했어요. 다시 촬영해 주세요.'));
    };
    // The URI has already been restricted to a size-bounded JPEG/PNG data URL.
    image.src = uri;
  });
}

/** Store camera bytes separately from AsyncStorage; no image is uploaded. */
export async function saveDosePhoto(capture: DosePhotoCapture): Promise<DosePhoto> {
  const photo = normalizeDosePhoto({
    id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`,
    capturedAt: capture.capturedAt,
    width: capture.width,
    height: capture.height,
    verification: normalizePhotoVerification(capture.verification, capture.capturedAt),
  });
  const blob = captureBlob(capture.uri);
  await validateImage(capture.uri, photo);
  await transact('readwrite', store => store.add(blob, photo.id));
  return photo;
}

export async function loadDosePhotoUri(photo: DosePhoto): Promise<string> {
  const checked = normalizeDosePhoto(photo);
  const blob: unknown = await transact('readonly', store => store.get(checked.id));
  if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_PHOTO_BYTES || !['image/jpeg', 'image/png'].includes(blob.type)) {
    throw new Error('저장된 사진을 찾을 수 없어요.');
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('사진을 불러오지 못했어요.'));
    reader.onerror = () => reject(new Error('사진을 불러오지 못했어요.'));
    reader.onabort = () => reject(new Error('사진 불러오기가 중단됐어요.'));
    reader.readAsDataURL(blob);
  });
}

export async function removeDosePhoto(photo: DosePhoto): Promise<void> {
  const checked = normalizeDosePhoto(photo);
  await transact('readwrite', store => store.delete(checked.id));
}
