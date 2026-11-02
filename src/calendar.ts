import { addDays, localDateKey } from './domain.ts';

/** Only accept real local dates from links, without UTC conversion or rollover. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return addDays(value, 0) === value;
  } catch {
    return false;
  }
}

export function startOfMonth(date: string): string {
  return addDays(date, 1 - Number(date.slice(-2)));
}

export function shiftMonth(date: string, amount: number): string {
  if (!Number.isInteger(amount)) throw new Error('월 간격은 정수여야 해요.');
  const start = startOfMonth(date);
  const [year, month] = start.split('-').map(Number);
  const next = localDateKey(new Date(year, month - 1 + amount, 1, 12));
  if (!isCalendarDate(next)) throw new Error('지원하는 날짜 범위를 벗어났어요.');
  return next;
}

/** Sunday-first weeks; blank cells keep the first and last weeks aligned. */
export function calendarDays(date: string): (string | null)[] {
  const start = startOfMonth(date);
  const [year, month] = start.split('-').map(Number);
  const leading = new Date(year, month - 1, 1, 12).getDay();
  const count = new Date(year, month, 0, 12).getDate();
  const length = Math.ceil((leading + count) / 7) * 7;
  return Array.from({ length }, (_, index) => {
    const day = index - leading;
    return day >= 0 && day < count ? addDays(start, day) : null;
  });
}
