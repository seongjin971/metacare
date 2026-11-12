/** Native OCR and image-quality measurements. This data stays in memory. */
export type PhotoAnalysis = {
  text: string;
  width: number;
  height: number;
  /** Grayscale mean, 0–255. */
  meanLuminance: number;
  /** Fraction of grayscale pixels below 32, 0–1. */
  darkPixelRatio: number;
  /** Four-neighbor Laplacian variance at a maximum image edge of 320px. */
  blurScore: number;
};

export type MedicinePouchCheck =
  | { ok: true; method: 'medicine-pouch-text-v1' }
  | {
    ok: false;
    reason: 'invalid' | 'too_dark' | 'too_blurry' | 'not_pouch' | 'uncertain' | 'wrong_slot';
    message: string;
  };

type FailureReason = Extract<MedicinePouchCheck, { ok: false }>['reason'];

const DOSE_SLOTS = ['아침', '점심', '저녁'] as const;
export type DoseSlot = typeof DOSE_SLOTS[number];

/** Dose labels start with their slot ("저녁 복용약"); a once-daily dose has none. */
export function doseSlot(label: string): DoseSlot | undefined {
  return DOSE_SLOTS.find(slot => label.startsWith(slot));
}

function fail(reason: FailureReason, message: string): MedicinePouchCheck {
  return { ok: false, reason, message };
}

function isAnalysis(value: unknown): value is PhotoAnalysis {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const photo = value as Record<string, unknown>;
  return typeof photo.text === 'string' && photo.text.length <= 20000
    && typeof photo.width === 'number' && Number.isInteger(photo.width) && photo.width > 0 && photo.width <= 20000
    && typeof photo.height === 'number' && Number.isInteger(photo.height) && photo.height > 0 && photo.height <= 20000
    && typeof photo.meanLuminance === 'number' && Number.isFinite(photo.meanLuminance)
    && photo.meanLuminance >= 0 && photo.meanLuminance <= 255
    && typeof photo.darkPixelRatio === 'number' && Number.isFinite(photo.darkPixelRatio)
    && photo.darkPixelRatio >= 0 && photo.darkPixelRatio <= 1
    && typeof photo.blurScore === 'number' && Number.isFinite(photo.blurScore) && photo.blurScore >= 0;
}

/**
 * Preliminary OCR eligibility rules, not a trained pouch/object classifier.
 * Printed instructions can resemble a pouch, so this cannot establish object
 * authenticity or medication ingestion. Thresholds need real-pouch calibration.
 * Return only a method/reason; never persist OCR text as verification metadata.
 */
export function checkMedicinePouch(analysis: unknown, slot?: DoseSlot): MedicinePouchCheck {
  if (!isAnalysis(analysis)) {
    return fail('invalid', '사진을 검사하지 못했어요. 다시 촬영해 주세요.');
  }
  if (Math.min(analysis.width, analysis.height) < 320) {
    return fail('uncertain', '작은 약봉투 한 포가 크게 보이도록 가까이에서 다시 촬영해 주세요.');
  }
  // A timestamp or a small bright corner must not make a black frame eligible.
  if (analysis.meanLuminance < 30 || analysis.darkPixelRatio > 0.9) {
    return fail('too_dark', '사진이 너무 어두워요. 밝은 곳에서 작은 약봉투를 다시 촬영해 주세요.');
  }
  if (analysis.blurScore < 18) {
    return fail('too_blurry', '사진이 흐려요. 작은 약봉투의 시간·복용 문구에 초점을 맞춰 다시 촬영해 주세요.');
  }

  // OCR may split Korean syllables or use full-width digits on printed labels.
  const text = analysis.text.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
  if (!text) return fail('uncertain', '글자를 읽지 못했어요. 작은 약봉투의 시간·복용 문구가 선명하게 보이도록 다시 촬영해 주세요.');

  // Documents are not a substitute for the requested medicine pouch photograph.
  if (/처방전|영수증|계산서|결제내역|복약안내문|복약안내서|조제내역서|약품설명서|거래명세서/.test(text)) {
    return fail('not_pouch', '안내문이나 영수증 대신 약이 담긴 작은 약봉투 한 포를 촬영해 주세요.');
  }

  const dispensingSource = /약국|조제(?:일자?|날짜|번호|약사|약|의약품)|약사(?:명|이름)/.test(text);
  // Negative lookahead avoids interpreting ordinary words such as 아침약속 as a label.
  const doseLabel = /(?:아침|점심|저녁|취침)약(?!속|정|관)/.test(text);
  const mealMarker = /(?:아침|점심|저녁)(?!약속)/.test(text);
  const doseAmount = /(?:1일|하루)(?:[1-9]\d?|한|두|세|네)회|1회(?:[1-9]\d?(?:\.\d+)?)(?:정|캡슐|포|알|봉|ml)/.test(text);
  const timing = /식전|식후|취침전|취침시|공복|식간/.test(text);
  const intakeInstruction = /복용|드세요|먹는약|먹으세요/.test(text);
  const detailedTiming = /식(?:전|후)\d{1,3}분/.test(text);
  const dosingInstructions = doseAmount || (timing && (intakeInstruction || detailedTiming));

  // A transparent unit-dose pouch may print only "아침 / 식후 30분" and a date.
  // Pharmacy names are optional; bare "아침 / 식후" still lacks enough context.
  const unitDoseInstructions = (mealMarker && detailedTiming)
    || (mealMarker && timing && dispensingSource)
    || (doseLabel && timing);
  if (unitDoseInstructions || ((dispensingSource || doseLabel) && dosingInstructions)) {
    // A pouch printed only for other meals cannot verify this dose. Pouches without a meal word stay eligible.
    const printed = DOSE_SLOTS.filter(item => new RegExp(`${item}(?!약속)`).test(text));
    if (slot && printed.length && !printed.includes(slot)) {
      return fail('wrong_slot', `${printed.join('·')} 약봉투로 보여요. ${slot} 약봉투를 촬영해 주세요.`);
    }
    return { ok: true, method: 'medicine-pouch-text-v1' };
  }
  if (dispensingSource || doseLabel || mealMarker || timing || doseAmount || intakeInstruction) {
    return fail('uncertain', '작은 약봉투를 확인하기 어려워요. 아침·점심·저녁과 복용 문구가 함께 보이도록 다시 촬영해 주세요.');
  }
  return fail('not_pouch', '작은 약봉투를 확인하지 못했어요. 약이 담긴 한 포의 시간·복용 문구를 다시 촬영해 주세요.');
}
