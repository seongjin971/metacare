import { clearCareAlertLaunch } from './care-alert-launch.web';

export function setForegroundNotificationRole(role: 'patient' | 'caregiver' | null) {
  // Opening an old guardian notification in patient mode must not replay it if the
  // user later changes roles in the same page.
  if (role === 'patient') clearCareAlertLaunch();
}
