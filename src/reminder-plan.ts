import { localDateKey, type AppState } from './domain.ts';
import { normalizeReminderOffsets } from './reminder-settings.ts';

export const REMINDER_PREFIX = 'metacare-reminder-';
export const TEST_REMINDER_ID = 'metacare-test';
export const MAX_SCHEDULED_REMINDERS = 48;

export function isPatientReminder(id: string) {
  return id.startsWith(REMINDER_PREFIX) || id === TEST_REMINDER_ID;
}

export type PlannedReminder = {
  id: string;
  at: number;
  entityId: string;
  url: '/appointments' | '/';
};

function localTimestamp(date: string, time: string) {
  return new Date(`${date}T${time}:00`).getTime();
}

/** Derive the next native alarms from saved choices without mutating app records. */
export function plannedReminders(state: AppState, now: number): PlannedReminder[] {
  const today = localDateKey(new Date(now));
  const visits: PlannedReminder[] = [];
  if (state.reminders.appointment) {
    const offsets = normalizeReminderOffsets('appointment', state.reminders.appointmentMinutesBefore);
    for (const visit of state.visits) {
      const start = localTimestamp(visit.date, visit.time);
      for (const minutesBefore of offsets) {
        const at = start - minutesBefore * 60 * 1000;
        if (!Number.isFinite(at) || at <= now) continue;
        visits.push({
          id: `${REMINDER_PREFIX}visit-${visit.id}-${at}`,
          at,
          entityId: visit.id,
          url: '/appointments',
        });
      }
    }
  }

  const medications: PlannedReminder[] = [];
  if (state.reminders.medication) {
    const offsets = normalizeReminderOffsets('medication', state.reminders.medicationMinutesBefore);
    // The current app generates a daily regimen when opened. Only today's actual
    // records are scheduled; retaining old history never creates new reminders.
    for (const dose of state.doses) {
      if (dose.status !== 'pending' || dose.date !== today) continue;
      const start = localTimestamp(dose.date, dose.time);
      for (const minutesBefore of offsets) {
        const at = start - minutesBefore * 60 * 1000;
        if (!Number.isFinite(at) || at <= now) continue;
        medications.push({
          id: `${REMINDER_PREFIX}dose-${dose.id}-${at}`,
          at,
          entityId: dose.id,
          url: '/',
        });
      }
    }
  }

  // Refill when the app opens or state changes, respecting the existing native
  // queue budget. Taking a dose or removing a visit removes all its offsets.
  return [...visits, ...medications.sort((a, b) => a.at - b.at).slice(0, 32)]
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_SCHEDULED_REMINDERS);
}
