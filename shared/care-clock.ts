const DAY = 86_400_000;

export function isCareTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 80) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
  catch { return false; }
}

/** Medication times are dates and clock times in the patient's time zone. */
export function careClock(timeZone = 'Asia/Seoul') {
  const format = new Intl.DateTimeFormat('en', {
    timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const wall = (epoch: number) => {
    const p = Object.fromEntries(format.formatToParts(epoch).map(({ type, value }) => [type, value]));
    return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':' + p.second;
  };
  const offsetAt = (epoch: number) => Date.parse(wall(epoch) + 'Z') - epoch;
  // A repeated clock time uses its first occurrence. A skipped clock time moves forward
  // by the daylight-saving gap, the same convention used by the local Date constructor.
  function instant(date: string, time: string) {
    const naive = Date.parse(date + 'T' + time + ':00Z');
    const before = naive - offsetAt(naive - DAY);
    const after = naive - offsetAt(naive + DAY);
    if (before === after || wall(before).slice(0, 16) === date + 'T' + time) return before;
    return wall(after).slice(0, 16) === date + 'T' + time ? after : Math.max(before, after);
  }
  return { wall, instant };
}
