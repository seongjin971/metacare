import type { CaregiverData, CareSnapshot } from '../../shared/care-types.ts';
import { careClock } from '../../shared/care-clock.ts';

export function upcomingSharedVisits(snapshot: CareSnapshot | null | undefined, now: Date) {
  const visits = snapshot?.upcomingVisits ?? (snapshot?.nextVisit ? [snapshot.nextVisit] : []);
  if (!visits.length) return [];
  // The original single-visit format used Seoul time when the patient zone was absent.
  const clock = careClock(snapshot?.visitTimeZone ?? snapshot?.timeZone);
  return visits.filter(visit => clock.instant(visit.date, visit.time) > now.getTime())
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.hospitalName.localeCompare(b.hospitalName));
}

/** Visit consent can be withdrawn while the caregiver is offline. Only medication data is cached. */
export function medicationCache(data: CaregiverData): CaregiverData {
  if (!data.snapshot) return data;
  const { patientName, schedule, doses, updatedAt, timeZone } = data.snapshot;
  return { ...data, snapshot: { patientName, schedule, doses, updatedAt, ...(timeZone && { timeZone }) } };
}
