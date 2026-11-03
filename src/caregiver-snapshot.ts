import type { SnapshotInput } from '../shared/care-types.ts';
import { localDateKey, upcomingVisits, type AppState } from './domain.ts';

/** The optional visit has its own consent, separate from sharing medication records. */
export function makeCareSnapshot(state: AppState, patientName: string, now = new Date(), shareNextVisit = false): SnapshotInput {
  const oldestDate = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89));
  const latestDate = localDateKey(now);
  const doses = state.doses.filter(dose => dose.date >= oldestDate && dose.date <= latestDate)
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)).slice(0, 300);
  const recentPhotos = doses.filter(dose => dose.status === 'taken' && dose.photo)
    .sort((a, b) => b.photo!.capturedAt.localeCompare(a.photo!.capturedAt)).slice(0, 30);
  const photoIds = new Set(recentPhotos.map(dose => dose.photo!.id));
  const visit = shareNextVisit ? upcomingVisits(state, now)[0] : undefined;
  return {
    patientName,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
    ...(visit ? { nextVisit: { hospitalName: visit.hospitalName, date: visit.date, time: visit.time } } : {}),
    schedule: { frequency: state.medicationSchedule.frequency, times: [...state.medicationSchedule.times] },
    doses: doses.map(dose => ({
      id: dose.id, date: dose.date, time: dose.time, label: dose.label, status: dose.status,
      ...(dose.takenAt ? { takenAt: dose.takenAt } : {}),
      ...(dose.status === 'taken' && dose.photo && photoIds.has(dose.photo.id) ? { photo: {
        id: dose.photo.id, capturedAt: dose.photo.capturedAt, verified: !!dose.photo.verification,
      } } : {}),
    })),
  };
}
