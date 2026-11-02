export type ReminderKind = 'appointment' | 'medication';

export const REMINDER_PRESETS: Record<ReminderKind, readonly number[]> = {
  appointment: [0, 5, 10, 15, 30, 60, 120, 180, 720, 1440, 2880, 10080],
  medication: [0, 5, 10, 15, 30, 60, 120],
};

export const MAX_REMINDER_MINUTES: Record<ReminderKind, number> = {
  appointment: 30 * 24 * 60,
  medication: 24 * 60,
};

export const MAX_REMINDER_TIMES = 8;
export const DEFAULT_REMINDER_OFFSETS: Record<ReminderKind, readonly number[]> = {
  appointment: [1440, 60],
  medication: [0],
};

/** Normalize selections before persisting; zero means the scheduled time itself. */
export function normalizeReminderOffsets(kind: ReminderKind, values: unknown): number[] {
  if (kind !== 'appointment' && kind !== 'medication') throw new Error('알림 종류를 확인해 주세요.');
  if (!Array.isArray(values) || values.length === 0 || values.some(value =>
    typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_REMINDER_MINUTES[kind])) {
    throw new Error(`알림 시간은 0~${MAX_REMINDER_MINUTES[kind].toLocaleString('ko-KR')}분 사이로 설정해 주세요.`);
  }
  const unique = [...new Set<number>(values)];
  if (unique.length > MAX_REMINDER_TIMES) throw new Error(`알림 시간은 최대 ${MAX_REMINDER_TIMES}개까지 선택할 수 있어요.`);
  return unique.sort((a, b) => b - a);
}

export function formatReminderOffset(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0) throw new Error('올바른 알림 시간을 선택해 주세요.');
  if (minutes === 0) return '정시';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return `${[days ? `${days}일` : '', hours ? `${hours}시간` : '', rest ? `${rest}분` : ''].filter(Boolean).join(' ')} 전`;
}
