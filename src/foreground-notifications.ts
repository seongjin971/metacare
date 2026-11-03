import { clearLastNotificationResponse, getLastNotificationResponse, setNotificationHandler } from 'expo-notifications';
import { REMINDER_PREFIX } from './reminder-plan';

export type ForegroundRole = 'patient' | 'caregiver' | null;
let activeRole: ForegroundRole = null;
let installed = false;

export function setForegroundNotificationRole(role: ForegroundRole) {
  activeRole = role;
  try {
    const last = getLastNotificationResponse()?.notification.request;
    if (last && role) {
      const isCareAlert = last.content.data?.type === 'overdue-dose';
      const isPatientReminder = last.identifier.startsWith(REMINDER_PREFIX) || last.identifier === 'metacare-test';
      if ((role === 'patient' && isCareAlert) || (role === 'caregiver' && isPatientReminder)) clearLastNotificationResponse();
    }
  } catch { /* Some development hosts cannot read the launch notification. */ }
  if (installed) return;
  installed = true;
  setNotificationHandler({
    handleNotification: async ({ request }) => {
      const isCareAlert = request.content.data?.type === 'overdue-dose';
      const isPatientReminder = request.identifier.startsWith(REMINDER_PREFIX) || request.identifier === 'metacare-test';
      const show = (isCareAlert && activeRole === 'caregiver') || (isPatientReminder && activeRole === 'patient');
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
    },
  });
}
