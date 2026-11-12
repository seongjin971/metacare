import Constants from 'expo-constants';
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
import type { DevicePushToken, NotificationResponse } from 'expo-notifications';

export const CARE_ALERT_TYPE = 'care-overdue';

const installedApp = (Platform.OS === 'android' || Platform.OS === 'ios') && !isRunningInExpoGo();
// Android builds deliver through FCM only when built with the Firebase app config (see app.config.js).
const pushConfigured = Platform.OS === 'ios' || Constants.expoConfig?.extra?.caregiverPush === true;

export const supportsCareAlerts = installedApp && pushConfigured;
/** An installed build without push setup hides the alert option instead of offering one that cannot work. */
export const careAlertsHidden = installedApp && !pushConfigured;

// Import only in an installed mobile app. Expo Go has no remote push service.
function notifications(): typeof import('expo-notifications') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-notifications');
}

if (supportsCareAlerts && Constants.expoConfig?.slug === 'metacare-caregiver') {
  // The old standalone development workspace has no role picker.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/foreground-notifications').setForegroundNotificationRole('caregiver');
}

export async function hasAlertPermission(ask: boolean): Promise<boolean> {
  const api = notifications();
  if (Platform.OS === 'android') {
    const channel = await api.setNotificationChannelAsync('caregiver-overdue', {
      name: '복약 미기록', importance: api.AndroidImportance.DEFAULT,
      sound: 'default', lockscreenVisibility: api.AndroidNotificationVisibility.PRIVATE,
    });
    if (channel?.importance === api.AndroidImportance.NONE) return false;
  }
  let permissions = await api.getPermissionsAsync();
  const allowed = () => permissions.granted || permissions.ios?.status === api.IosAuthorizationStatus.PROVISIONAL;
  if (ask && !allowed() && permissions.canAskAgain) {
    permissions = await api.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  }
  return allowed();
}

export async function getAlertToken(devicePushToken?: DevicePushToken): Promise<string> {
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error('미기록 알림을 지원하는 메타케어를 설치해 주세요.');
  try {
    return (await notifications().getExpoPushTokenAsync({ projectId, devicePushToken })).data;
  } catch {
    throw new Error('이 기기의 알림을 등록하지 못했어요. 인터넷 연결과 앱 버전을 확인해 주세요.');
  }
}

export function watchAlertToken(onChange: (deviceToken: DevicePushToken) => void) {
  return notifications().addPushTokenListener(onChange);
}

export function watchAlertTaps(onTap: (response: NotificationResponse) => void) {
  const api = notifications();
  const handle = (response: NotificationResponse) => {
    if (response.actionIdentifier === api.DEFAULT_ACTION_IDENTIFIER && response.notification.request.content.data?.type === CARE_ALERT_TYPE) onTap(response);
  };
  const subscription = api.addNotificationResponseReceivedListener(handle);
  const launch = api.getLastNotificationResponse();
  if (launch) handle(launch);
  return subscription;
}

export function consumeAlertTap() {
  const api = notifications();
  if (api.getLastNotificationResponse()?.notification.request.content.data?.type === CARE_ALERT_TYPE) api.clearLastNotificationResponse();
}

export function clearDeliveredAlerts() {
  if (!supportsCareAlerts) return;
  consumeAlertTap();
  const api = notifications();
  void api.getPresentedNotificationsAsync().then(list => Promise.all(
    list.filter(item => item.request.content.data?.type === CARE_ALERT_TYPE)
      .map(item => api.dismissNotificationAsync(item.request.identifier))
  )).catch(() => undefined);
}
