export function suggestedVisitTime(isToday: boolean, now: Date): string {
  if (!isToday) return '09:00';
  const minutes = now.getHours() * 60 + now.getMinutes();
  const next = Math.min((Math.floor(minutes / 5) + 1) * 5, 23 * 60 + 59);
  return `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
}
