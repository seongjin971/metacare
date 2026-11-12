const WEEKDAYS = '일월화수목금토';
const pad = (value: number) => String(value).padStart(2, '0');

/**
 * The text burned into a dose photo, e.g. "메타케어 · 2026.11.12 (목) 오후 7:03".
 * Built by hand rather than with Intl so every device prints the same label.
 */
export function photoStampLabel(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error('촬영 시간을 확인할 수 없어요.');
  const hour = date.getHours();
  const meridiem = hour < 12 ? '오전' : '오후';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `메타케어 · ${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} (${WEEKDAYS[date.getDay()]}) ${meridiem} ${hour12}:${pad(date.getMinutes())}`;
}
