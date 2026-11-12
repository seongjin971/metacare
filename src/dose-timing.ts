import type { Dose } from './domain.ts';

/** Same grace period the caregiver screen uses before calling a dose overdue. */
export const OVERDUE_MINUTES = 30;

export type DoseTiming = { dose: Dose; state: 'overdue' | 'due' | 'upcoming'; minutesLate: number };

function minutesFrom(dose: Dose, now: Date): number {
  const [year, month, day] = dose.date.split('-').map(Number);
  const [hour, minute] = dose.time.split(':').map(Number);
  return Math.floor((now.getTime() - new Date(year, month - 1, day, hour, minute).getTime()) / 60000);
}

export function doseTiming(dose: Dose, now: Date): DoseTiming {
  const minutesLate = minutesFrom(dose, now);
  const state = minutesLate >= OVERDUE_MINUTES ? 'overdue' : minutesLate > -OVERDUE_MINUTES ? 'due' : 'upcoming';
  return { dose, state, minutesLate };
}

/** The one dose the patient should act on now: the earliest unrecorded one. Null when today's doses are all recorded. */
export function nextDose(todayDoses: readonly Dose[], now: Date): DoseTiming | null {
  const pending = todayDoses.filter(dose => dose.status === 'pending').sort((a, b) => a.time.localeCompare(b.time));
  return pending.length ? doseTiming(pending[0], now) : null;
}

export function lateText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours ? `${hours}시간 ` : ''}${hours && !rest ? '' : `${rest}분 `}지났어요`;
}
