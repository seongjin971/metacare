import type { AppState } from './domain';

export async function suspendPatientReminders(): Promise<void> {}

export type NotificationSyncResult = {
  status: 'ready' | 'denied' | 'unsupported' | 'error' | 'disabled';
  message: string;
  count: number;
};

function unsupported(): NotificationSyncResult {
  return {
    status: 'unsupported',
    message: '복약·진료 일정 알림은 휴대폰에 설치한 메타케어 앱에서 받을 수 있어요.',
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
