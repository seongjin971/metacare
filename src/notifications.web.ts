import type { AppState } from './domain';

export type NotificationSyncResult = {
  status: 'ready' | 'denied' | 'unsupported' | 'error' | 'disabled';
  message: string;
  count: number;
};

function unsupported(): NotificationSyncResult {
  return {
    status: 'unsupported',
    message: '브라우저 미리보기에서는 기기 알림을 보내지 않아요. Android·iPhone 앱에서 확인해 주세요.',
    count: 0,
  };
}

export async function requestReminderPermission(): Promise<NotificationSyncResult> {
  return unsupported();
}

export async function syncReminders(state: AppState): Promise<NotificationSyncResult> {
  if (!state.reminders.appointment && !state.reminders.medication) {
    return { status: 'disabled', message: '일정 알림이 꺼져 있어요.', count: 0 };
  }
  return unsupported();
}

export async function scheduleTestReminder(): Promise<NotificationSyncResult> {
  return unsupported();
}
