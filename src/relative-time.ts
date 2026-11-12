/** "방금", "5분 전", "3시간 전", or "11월 12일 16:06" — how people say when something happened. */
export function relativeTime(value: string | null | undefined, now: number | Date): string | null {
  const time = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return null;
  const current = typeof now === 'number' ? now : now.getTime();
  const minutes = Math.floor((current - time) / 60000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 12 * 60) return `${Math.floor(minutes / 60)}시간 전`;
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(time);
}
