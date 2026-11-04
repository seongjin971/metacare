import type { SharedVisit, SnapshotInput, VisitUpdate } from '../shared/care-types.ts';
import { MAX_SHARED_VISITS } from '../shared/care-visit.ts';
import { localDateKey, upcomingVisits, type AppState } from './domain.ts';

/** A legacy opt-in shares one visit; the agenda requires its own explicit scope. */
export function makeCareSnapshot(state: AppState, patientName: string, now = new Date(), shareVisits = false, scope?: VisitUpdate['scope']): SnapshotInput {
  const oldestDate = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89));
  const latestDate = localDateKey(now);
  const doses = state.doses.filter(dose => dose.date >= oldestDate && dose.date <= latestDate)
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)).slice(0, 300);
  const recentPhotos = doses.filter(dose => dose.status === 'taken' && dose.photo)
    .sort((a, b) => b.photo!.capturedAt.localeCompare(a.photo!.capturedAt)).slice(0, 30);
  const photoIds = new Set(recentPhotos.map(dose => dose.photo!.id));
  const visits: SharedVisit[] = [];
  if (shareVisits) {
    const limit = scope === 'upcoming' ? MAX_SHARED_VISITS : 1;
    const seen = new Set<string>();
    for (const { hospitalName, date, time } of upcomingVisits(state, now)) {
      // Older stores can have distinct local IDs for the same appointment.
      const key = JSON.stringify([hospitalName, date, time]);
      if (seen.has(key)) continue;
      seen.add(key);
      visits.push({ hospitalName, date, time });
      if (visits.length === limit) break;
    }
  }
  return {
    patientName,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
    ...(visits[0] && { nextVisit: visits[0] }),
    ...(shareVisits && scope === 'upcoming' && { upcomingVisits: visits }),
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
