import { keys, record, type Patient } from './care-core.ts';
import { eligibleOverdueSlot, nextOverdueSlot, parseOverdueSettings, type OverdueSettings, type OverdueSlot } from './overdue.ts';
import { isCareDate, isCareTime } from '../shared/care-visit.ts';

export type LocalAlert = {
  patientId: string;
  connectedAt: string;
  settings: OverdueSettings;
  next: OverdueSlot | null;
  retryAt?: number;
  sent: string[];
};

export function validLocalAlerts(items: unknown, patients: Patient[]): items is LocalAlert[] {
  if (!Array.isArray(items)) return false;
  const family = new Set<string>();
  const tokens = new Set<string>();
  return items.every(item => {
    if (!record(item) || !keys(item, ['patientId', 'connectedAt', 'settings', 'next', 'sent'], ['retryAt'])
      || (item.retryAt !== undefined && (!Number.isSafeInteger(item.retryAt) || item.next === null))
      || typeof item.patientId !== 'string' || typeof item.connectedAt !== 'string'
      || !patients.some(p => p.id === item.patientId && p.caregiver?.connectedAt === item.connectedAt)
      || family.has(item.patientId) || !Array.isArray(item.sent) || !item.sent.every(key =>
        typeof key === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(key))) return false;
    family.add(item.patientId);
    try {
      const settings = parseOverdueSettings(item.settings);
      if (settings.enabled) {
        if (tokens.has(settings.expoPushToken)) return false;
        tokens.add(settings.expoPushToken);
      } else if (item.next !== null) return false;
    } catch { return false; }
    const next = item.next;
    return next === null || (record(next) && keys(next, ['date', 'time', 'dueAt']) && Number.isSafeInteger(next.dueAt)
      && isCareDate(next.date) && isCareTime(next.time));
  });
}

export function planLocalAlert(alert: LocalAlert, patient: Patient, now: number): LocalAlert {
  if (!alert.settings.enabled) return { ...alert, next: null };
  // If a deadline is already queued, evaluate it against the latest snapshot in the worker.
  if (alert.next && alert.next.dueAt <= now) return alert;
  return { ...alert, next: nextOverdueSlot(patient.snapshot, alert.settings.threshold, now, alert.settings.timeZone) };
}

export function disableLocalAlert(alert: LocalAlert): LocalAlert {
  return { ...alert, settings: { enabled: false, threshold: alert.settings.threshold }, next: null, retryAt: undefined };
}

export function updateLocalAlerts(alerts: LocalAlert[], patient: Patient, body: unknown, now: number): LocalAlert[] {
  const settings = parseOverdueSettings(body);
  const old = alerts.find(alert => alert.patientId === patient.id);
  const samePlan = old?.settings.enabled && settings.enabled && settings.threshold === old.settings.threshold
    && settings.timeZone === old.settings.timeZone;
  const next = planLocalAlert({
    patientId: patient.id, connectedAt: patient.caregiver!.connectedAt, settings,
    next: samePlan ? old.next : null, retryAt: samePlan ? old.retryAt : undefined, sent: old?.sent ?? [],
  }, patient, now);
  // A device token belongs to only one active recipient, even after reinstalling and pairing again.
  const others = alerts.filter(alert => alert.patientId !== patient.id).map(alert =>
    settings.enabled && alert.settings.enabled && settings.expoPushToken === alert.settings.expoPushToken
      ? disableLocalAlert(alert) : alert);
  return [...others, next];
}

export function claimLocalAlert(alert: LocalAlert, patient: Patient, now: number) {
  const { next, settings } = alert;
  if (!settings.enabled || !next || next.dueAt > now || (alert.retryAt ?? 0) > now) return;
  const key = next.date + 'T' + next.time;
  const send = !alert.sent.includes(key) && eligibleOverdueSlot(patient.snapshot, settings.threshold, next, now, settings.timeZone);
  const keepSince = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
  const sent = alert.sent.filter(value => value >= keepSince);
  if (send) sent.push(key);
  return {
    alert: planLocalAlert({ ...alert, next: null, retryAt: undefined, sent }, patient, now),
    notification: send ? { token: settings.expoPushToken, slot: next } : undefined,
  };
}
