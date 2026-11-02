import { requireOptionalNativeModule } from 'expo-modules-core';

export type PhotoAnalysis = {
  text: string;
  /** Original image dimensions after applying its orientation. */
  width: number;
  height: number;
  /** Mean Rec.601 grayscale intensity, in the range 0–255. */
  meanLuminance: number;
  /** Fraction of sampled pixels whose grayscale intensity is below 32. */
  darkPixelRatio: number;
  /** Variance of the four-neighbor Laplacian; quality sample longest edge is 320 px. */
  blurScore: number;
};

type PhotoAnalyzerModule = {
  analyzePhoto(uri: string): Promise<PhotoAnalysis>;
};

const nativeAnalyzer = requireOptionalNativeModule<PhotoAnalyzerModule>('MedicationPhotoAnalyzer');

export function isPhotoAnalyzerAvailable(): boolean {
  return nativeAnalyzer !== null;
}

export async function analyzePhoto(uri: string): Promise<PhotoAnalysis> {
  if (!nativeAnalyzer) {
    throw new Error('사진 자동 확인 기능이 포함된 설치 앱에서 촬영해 주세요.');
  }
  return nativeAnalyzer.analyzePhoto(uri);
}
