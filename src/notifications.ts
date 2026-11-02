import { Platform } from 'react-native';
import {
  AndroidImportance,
  AndroidNotificationVisibility,
  IosAuthorizationStatus,
  SchedulableTriggerInputTypes,
  cancelScheduledNotificationAsync,
  getAllScheduledNotificationsAsync,
  getPermissionsAsync,
  requestPermissionsAsync,
  scheduleNotificationAsync,
  setNotificationChannelAsync,
  setNotificationHandler,
  type NotificationPermissionsStatus,
} from 'expo-notifications';
import type { AppState } from './domain';
import { plannedReminders, REMINDER_PREFIX } from './reminder-plan';

export type NotificationSyncResult = {
  status: 'ready' | 'denied' | 'unsupported' | 'error' | 'disabled';
  message: string;
  count: number;
};

const CHANNEL_ID = 'metacare-private-reminders';
const TEST_ID = 'metacare-test';
let queue: Promise<unknown> = Promise.resolve();

setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Permission prompts, reconciliation and tests are serialized, so a slower old
// reconciliation cannot restore reminders that a newer state has cancelled.
function serialized(task: () => Promise<NotificationSyncResult>) {
  const result = queue.then(task, task).catch((): NotificationSyncResult => ({
    status: 'error',
    message: '기기 알림을 확인하지 못했어요. 알림 설정에서 다시 시도해 주세요.',
    count: 0,
  }));
  queue = result;
  return result;
}

async function ensureChannel() {
  if (Platform.OS === 'android') {
    await setNotificationChannelAsync(CHANNEL_ID, {
      name: '일정 알림',
      description: '앱에서 설정한 일정 알림',
      importance: AndroidImportance.DEFAULT,
      sound: 'default',
      lockscreenVisibility: AndroidNotificationVisibility.PRIVATE,
      showBadge: false,
    });
  }
}

function isAllowed(permission: NotificationPermissionsStatus) {
  return permission.granted ||
    permission.ios?.status === IosAuthorizationStatus.PROVISIONAL;
}

function deniedResult(count = 0): NotificationSyncResult {
  return {
    status: 'denied',
    message: '알림 권한이 꺼져 있어요. 휴대폰 설정에서 메타케어 알림을 허용해 주세요.',
    count,
  };
}

/** Call only after the user chooses to enable device reminders. */
export function requestReminderPermission(): Promise<NotificationSyncResult> {
  return serialized(async () => {
    await ensureChannel();
    let permission = await getPermissionsAsync();
    if (!isAllowed(permission) && permission.canAskAgain) {
      permission = await requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      });
    }
    if (!isAllowed(permission)) return deniedResult();
    return {
      status: 'ready',
      message: '기기 알림 권한이 확인됐어요. 받을 알림을 선택해 주세요.',
      count: 0,
    };
  });
}

/** Reconciles only this app's managed IDs and never opens a permission prompt. */
export function syncReminders(state: AppState): Promise<NotificationSyncResult> {
  return serialized(async () => {
    await ensureChannel();
    const permission = await getPermissionsAsync();
    const allowed = isAllowed(permission);
    const disabled = !state.reminders.appointment && !state.reminders.medication;
    const planned = allowed ? plannedReminders(state, Date.now()) : [];
    const desired = new Map(planned.map(reminder => [reminder.id, reminder]));
    const scheduled = (await getAllScheduledNotificationsAsync())
      .filter(notification => notification.identifier.startsWith(REMINDER_PREFIX));
    const active = new Set(scheduled.map(notification => notification.identifier));
    let failed = false;

    // Cancellation runs even when permission was revoked or every toggle is off.
    for (const notification of scheduled) {
      const reminder = desired.get(notification.identifier);
      if (reminder && notification.content.data?.url === reminder.url &&
        notification.content.data?.entityId === reminder.entityId) continue;
      try {
        await cancelScheduledNotificationAsync(notification.identifier);
        active.delete(notification.identifier);
      } catch {
        failed = true;
      }
    }

    for (const reminder of planned) {
      if (active.has(reminder.id)) continue;
      // Time can pass while another reconciliation waits in the serialized queue.
      if (reminder.at <= Date.now()) continue;
      try {
        await scheduleNotificationAsync({
          identifier: reminder.id,
          content: {
            title: '메타케어',
            body: '확인할 일정이 있어요. 앱을 열어 확인해 주세요.',
            sound: 'default',
            data: { url: reminder.url, entityId: reminder.entityId },
          },
          trigger: {
            type: SchedulableTriggerInputTypes.DATE,
            date: new Date(reminder.at),
            channelId: CHANNEL_ID,
          },
        });
        active.add(reminder.id);
      } catch {
        failed = true;
      }
    }

    if (failed) {
      return {
        status: 'error',
        message: '일부 알림을 등록하거나 취소하지 못했어요. 설정에서 다시 시도해 주세요.',
        count: active.size,
      };
    }
    if (disabled) return { status: 'disabled', message: '일정 알림이 꺼져 있어요.', count: 0 };
    if (!allowed) return deniedResult(active.size);
    return {
      status: 'ready',
      message: active.size > 0
        ? `${active.size}개의 기기 알림이 예약됐어요. 기기 설정에 따라 표시 시간이 달라질 수 있어요.`
        : '알림 설정이 켜져 있어요. 현재 등록할 미래 일정은 없어요.',
      count: active.size,
    };
  });
}

/** Tests local delivery; permission is requested separately by the UI. */
export function scheduleTestReminder(): Promise<NotificationSyncResult> {
  return serialized(async () => {
    await ensureChannel();
    if (!isAllowed(await getPermissionsAsync())) return deniedResult();
    await scheduleNotificationAsync({
      identifier: TEST_ID,
      content: {
        title: '메타케어',
        body: '기기 알림 테스트예요. 알림이 잘 도착했어요.',
        sound: 'default',
        data: { url: '/settings' },
      },
      trigger: {
        type: SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 10,
        channelId: CHANNEL_ID,
      },
    });
    return { status: 'ready', message: '10초 뒤 테스트 알림이 예약됐어요.', count: 1 };
  });
}
