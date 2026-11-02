import type { SharedDose } from '../../shared/care-types.ts';

export const OVERDUE_THRESHOLDS = [15, 30, 60, 120] as const;
export type OverdueThreshold = typeof OVERDUE_THRESHOLDS[number];
export type DoseState = 'recorded' | 'overdue' | 'waiting' | 'scheduled' | 'unknown';

/** A missing record is not evidence that a person did or did not take medicine. */
export function getDoseState(dose: SharedDose, thresholdMinutes: number, now = new Date()): DoseState {
  if (dose.status === 'taken') return 'recorded';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dose.date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(dose.time)) return 'unknown';
  const [year, month, day] = dose.date.split('-').map(Number);
  const [hour, minute] = dose.time.split(':').map(Number);
  const due = new Date(year, month - 1, day, hour, minute);
  if (!Number.isFinite(now.getTime()) || due.getFullYear() !== year || due.getMonth() !== month - 1 || due.getDate() !== day) return 'unknown';
  const elapsed = now.getTime() - due.getTime();
  const threshold = Number.isFinite(thresholdMinutes) && thresholdMinutes > 0 ? thresholdMinutes : 30;
  if (elapsed < 0) return 'scheduled';
  return elapsed >= threshold * 60_000 ? 'overdue' : 'waiting';
}

export function summarizeDoses(doses: SharedDose[], thresholdMinutes: number, now = new Date()) {
  return doses.reduce((summary, dose) => {
    summary[getDoseState(dose, thresholdMinutes, now)] += 1;
    return summary;
  }, { total: doses.length, recorded: 0, overdue: 0, waiting: 0, scheduled: 0, unknown: 0 });
}

/** Server reachability and the age of the patient's last upload are separate. */
export function isSnapshotStale(updatedAt: string | null | undefined, fetchedAt: string | null, now = new Date()): boolean {
  const uploaded = Date.parse(updatedAt ?? '');
  const fetched = Date.parse(fetchedAt ?? '');
  const current = now.getTime();
  return !Number.isFinite(uploaded) || !Number.isFinite(fetched) || !Number.isFinite(current)
    || current - uploaded > 5 * 60_000 || current - fetched > 30_000;
}
