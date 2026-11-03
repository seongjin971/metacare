import { createInitialState, ensureDailyDoses, localDateKey, validateLoadedState, type AppState, type Dose } from './domain.ts';
import { createSamplePatientState } from './sample-patient-state.ts';

export const SAMPLE_MEDICATION_KEY = 'metacare.sample-medication.v1';

function firstDay(doses: Dose[], now: Date) {
  return doses.reduce((first, dose) => dose.date < first ? dose.date : first, localDateKey(now));
}

function requireVerifiedCompletions(doses: Dose[]) {
  if (doses.some(dose => dose.status === 'taken' && !dose.photo?.verification)) {
    throw new Error('약봉투 사진 인증이 없는 복약 기록은 저장할 수 없어요.');
  }
}

/** Only actual schedules and their photo-backed records enter this device-only key. */
export function serializeSampleMedication(state: AppState): string {
  requireVerifiedCompletions(state.doses);
  return JSON.stringify({ doses: state.doses, medicationSchedule: state.medicationSchedule });
}

export function restoreSampleMedication(raw: string | null, now = new Date()): AppState {
  let live = createInitialState(now);
  if (raw !== null) {
    const saved = JSON.parse(raw);
    live = validateLoadedState({ ...live, doses: saved.doses, medicationSchedule: saved.medicationSchedule });
    requireVerifiedCompletions(live.doses);
    live = ensureDailyDoses(live, now);
  }
  const initial = createSamplePatientState(new Date(`${firstDay(live.doses, now)}T12:00:00`));
  return { ...initial, medicationSchedule: live.medicationSchedule, doses: live.doses };
}

/** Historical fixtures belong to the read model, never a mutation or a disk write. */
export function withSampleMedicationHistory(live: AppState, now: Date): AppState {
  const first = firstDay(live.doses, now);
  const initial = createSamplePatientState(new Date(`${first}T12:00:00`));
  return { ...live, doses: [...initial.doses.filter(dose => dose.date < first), ...live.doses] };
}
