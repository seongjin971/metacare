import { clearLastNotificationResponse, dismissNotificationAsync, getLastNotificationResponse, getPresentedNotificationsAsync, setNotificationHandler } from 'expo-notifications';
import { isPatientReminder } from './reminder-plan';

/** Caregiver overdue alerts; matches the server payload type. */
const CARE_ALERT_TYPE = 'care-overdue';

export type ForegroundRole = 'patient' | 'caregiver' | null;
let activeRole: ForegroundRole = null;
let installed = false;

export function setForegroundNotificationRole(role: ForegroundRole) {
  activeRole = role;
  try {
    const last = getLastNotificationResponse()?.notification.request;
    if (last && role) {
      const isCareAlert = last.content.data?.type === CARE_ALERT_TYPE;
      // Keep a launch tap only for the role it belongs to, so the right screen can open it.
      if ((isCareAlert && role !== 'caregiver') || (!isCareAlert && (!isPatientReminder(last.identifier) || role !== 'patient'))) clearLastNotificationResponse();
    }
  } catch { /* Some development hosts cannot read the launch notification. */ }
  if (installed) return;
  installed = true;
  // Remove medication details from notifications delivered by an earlier version.
  void getPresentedNotificationsAsync().then(list => Promise.all(list
    .filter(item => item.request.content.data?.type === 'overdue-dose')
    .map(item => dismissNotificationAsync(item.request.identifier)))).catch(() => {});
  setNotificationHandler({
    handleNotification: async ({ request }) => {
      const show = (isPatientReminder(request.identifier) && activeRole === 'patient')
        || (request.content.data?.type === CARE_ALERT_TYPE && activeRole === 'caregiver');
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
    },
  });
}
