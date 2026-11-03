import { clearLastNotificationResponse, dismissNotificationAsync, getLastNotificationResponse, getPresentedNotificationsAsync, setNotificationHandler } from 'expo-notifications';
import { isPatientReminder } from './reminder-plan';

export type ForegroundRole = 'patient' | 'caregiver' | null;
let activeRole: ForegroundRole = null;
let installed = false;

export function setForegroundNotificationRole(role: ForegroundRole) {
  activeRole = role;
  try {
    const last = getLastNotificationResponse()?.notification.request;
    if (last && role) {
      if (!isPatientReminder(last.identifier) || role !== 'patient') clearLastNotificationResponse();
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
      const show = isPatientReminder(request.identifier) && activeRole === 'patient';
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
    },
  });
}
