import { analyzePhoto, isPhotoAnalyzerAvailable } from '../modules/medication-photo-analyzer';
import { checkMedicinePouch } from './medicine-pouch-check';
import type { PhotoVerification } from './dose-photo';

export type DoseCapture = { uri: string; capturedAt: string; width: number; height: number };
export type VerifiedDoseCapture = DoseCapture & { verification: PhotoVerification };
export { isPhotoAnalyzerAvailable };

export async function verifyDosePhoto(capture: DoseCapture): Promise<
  { ok: true; capture: VerifiedDoseCapture } | { ok: false; message: string }
> {
  if (!isPhotoAnalyzerAvailable()) return { ok: false, message: '사진 확인 기능이 포함된 설치 앱에서 촬영해 주세요.' };
  try {
    const analysis = await analyzePhoto(capture.uri);
    const result = checkMedicinePouch(analysis);
    if (!result.ok) return result;
    return { ok: true, capture: { ...capture, verification: { method: result.method, checkedAt: new Date().toISOString() } } };
  } catch {
    return { ok: false, message: '사진을 확인하지 못했어요. 약봉투 글씨가 보이도록 다시 촬영해 주세요.' };
  }
}
