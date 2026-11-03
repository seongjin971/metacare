import type { CareSnapshot } from '../shared/care-types.ts';
import { isCareDate, isCareTime } from '../shared/care-visit.ts';
import { careClock, isCareTimeZone } from '../shared/care-clock.ts';
import { HttpError } from './care-errors.ts';

type Threshold = 15 | 30 | 60 | 120;
export type OverdueSettings = { threshold: Threshold; timeZone?: string } & (
  { enabled: true; expoPushToken: string } | { enabled: false }
);
export type OverdueSlot = { date: string; time: string; dueAt: number };
export type OverdueJob = OverdueSlot & { patientId: string; generation: string };
export type EnqueueOverdue = (job: OverdueJob) => Promise<void>;

export { isCareTimeZone as validTimeZone };

export function parseOverdueSettings(input: unknown): OverdueSettings {
  const invalid = () => new HttpError(400, '미기록 알림 설정을 확인해 주세요.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const obj = input as Record<string, unknown>;
  if (Object.keys(obj).some(key => !['enabled', 'threshold', 'expoPushToken', 'timeZone'].includes(key))
    || ![15, 30, 60, 120].includes(obj.threshold as number) || typeof obj.enabled !== 'boolean'
    || (obj.timeZone !== undefined && !isCareTimeZone(obj.timeZone))) throw invalid();
  const base = { threshold: obj.threshold as Threshold, ...(typeof obj.timeZone === 'string' && { timeZone: obj.timeZone }) };
  if (!obj.enabled) return { ...base, enabled: false };
  if (typeof obj.expoPushToken !== 'string' || !/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{8,180}\]$/.test(obj.expoPushToken)) throw invalid();
  return { ...base, enabled: true, expoPushToken: obj.expoPushToken };
}

export function isOverdueJob(value: unknown): value is OverdueJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Record<string, unknown>;
  return typeof job.patientId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(job.patientId)
    && typeof job.generation === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(job.generation)
    && isCareDate(job.date) && isCareTime(job.time) && Number.isSafeInteger(job.dueAt);
}

const DAY = 86_400_000;

function slotsForDate(snapshot: CareSnapshot, date: string) {
  const rows = snapshot.doses.filter(dose => dose.date === date);
  // After a dose is recorded, changing the recurring schedule may deliberately leave that
  // day's actual rows unchanged. Future days still work without opening the patient app.
  return rows.length ? rows : snapshot.schedule.times.map(time => ({ time, status: 'pending' as const }));
}

export function nextOverdueSlot(snapshot: CareSnapshot | null, threshold: number, afterMs: number, fallbackZone?: string): OverdueSlot | null {
  if (!snapshot) return null;
  const { wall, instant } = careClock(snapshot.timeZone ?? fallbackZone);
  const from = Date.parse(wall(afterMs - threshold * 60_000).slice(0, 10) + 'T00:00:00Z');
  let earliest: OverdueSlot | null = null;
  for (let i = 0; i < 3; i++) {
    const date = new Date(from + i * DAY).toISOString().slice(0, 10);
    for (const { time } of slotsForDate(snapshot, date)) {
      const dueAt = instant(date, time) + threshold * 60_000;
      if (dueAt > afterMs && (!earliest || dueAt < earliest.dueAt)) earliest = { date, time, dueAt };
    }
  }
  return earliest;
}

export function eligibleOverdueSlot(snapshot: CareSnapshot | null, threshold: number, slot: OverdueSlot, nowMs: number, fallbackZone?: string): boolean {
  if (!snapshot || nowMs < slot.dueAt || nowMs - slot.dueAt > 60 * 60_000) return false;
  if (careClock(snapshot.timeZone ?? fallbackZone).instant(slot.date, slot.time) + threshold * 60_000 !== slot.dueAt) return false;
  const doses = slotsForDate(snapshot, slot.date).filter(item => item.time === slot.time);
  return doses.length > 0 && doses.every(item => item.status === 'pending');
}

/** A refusal before Expo accepts a message can be retried safely. A network timeout cannot. */
export class RetryablePushError extends Error {}

export async function sendOverduePush(token: string, slot: OverdueSlot, connectedAt: string): Promise<'accepted' | 'unregistered'> {
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST', signal: AbortSignal.timeout(7500),
    headers: { 'Content-Type': 'application/json', ...(process.env.EXPO_ACCESS_TOKEN && { Authorization: 'Bearer ' + process.env.EXPO_ACCESS_TOKEN }) },
    body: JSON.stringify({ to: token, title: '복약 기록 확인', body: slot.time + ' 복약 기록이 아직 없어요.',
      sound: 'default', channelId: 'caregiver-overdue', priority: 'high', ttl: 3600,
      data: { type: 'overdue-dose', date: slot.date, time: slot.time, connectedAt } }),
  });
  if (response.status === 429) throw new RetryablePushError('Expo push rate limited.');
  if (!response.ok) throw new Error('Expo push request failed (' + response.status + ').');
  const { data } = await response.json() as { data?: { status?: string; details?: { error?: string } } };
  if (data?.details?.error === 'DeviceNotRegistered') return 'unregistered';
  if (data?.details?.error === 'MessageRateExceeded') throw new RetryablePushError('Expo push rate limited.');
  if (data?.status !== 'ok') throw new Error('Expo rejected the notification.');
  return 'accepted';
}
