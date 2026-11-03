import Constants from 'expo-constants';
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
import type { DevicePushToken, NotificationResponse } from 'expo-notifications';

export const supportsCareAlerts = (Platform.OS === 'android' || Platform.OS === 'ios')
  && !isRunningInExpoGo();

// Import only in an installed mobile app. Expo Go has no remote push service.
function notifications(): typeof import('expo-notifications') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-notifications');
}

if (supportsCareAlerts) {
  notifications().setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
    }),
  });
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
  if (!projectId) throw new Error('미기록 알림이 설정된 보호자 앱을 설치해 주세요.');
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
    if (response.actionIdentifier === api.DEFAULT_ACTION_IDENTIFIER) onTap(response);
  };
  const subscription = api.addNotificationResponseReceivedListener(handle);
  const launch = api.getLastNotificationResponse();
  if (launch) handle(launch);
  return subscription;
}

export function consumeAlertTap() {
  notifications().clearLastNotificationResponse();
}

export function clearDeliveredAlerts() {
  if (!supportsCareAlerts) return;
  consumeAlertTap();
  void notifications().dismissAllNotificationsAsync().catch(() => undefined);
}
