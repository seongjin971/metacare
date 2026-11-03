export type TimePickerProps = {
  label: string;
  value: string | null;
  initialTime: string;
  onChange: (time: string) => void;
  disabled?: boolean;
};

export function parseClockNumber(part: 'hour' | 'minute', text: string): number | null {
  if (!/^\d{1,2}$/.test(text)) return null;
  const value = Number(text);
  const inRange = part === 'hour' ? value >= 1 && value <= 12 : value <= 59;
  return inRange ? value : null;
}

// Both medication schedules and visits store local wall-clock times as HH:mm.
export function toClockTime(period: '오전' | '오후', hour: string, minute: string): string | null {
  const h = parseClockNumber('hour', hour);
  const m = parseClockNumber('minute', minute);
  if (h === null || m === null) return null;
  const hour24 = h % 12 + (period === '오후' ? 12 : 0);
  return `${String(hour24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatClockTime(time: string): string {
  const [hour, minute] = time.split(':');
  const hour24 = Number(hour);
  return `${hour24 < 12 ? '오전' : '오후'} ${hour24 % 12 || 12}:${minute}`;
}
