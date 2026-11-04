import type { SharedVisit } from './care-types.ts';

export const MAX_SHARED_VISITS = 30;

export function isCareName(value: unknown, max = 40): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

export function isCareDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1000
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

export function isCareTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isSharedVisit(value: unknown): value is SharedVisit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 3 && isCareName(item.hospitalName, 80) && isCareDate(item.date) && isCareTime(item.time);
}

/** Multiple hospitals can have appointments in the same minute. */
export function isSharedVisitList(value: unknown): value is SharedVisit[] {
  if (!Array.isArray(value) || value.length > MAX_SHARED_VISITS || !value.every(isSharedVisit)) return false;
  const distinct = new Set(value.map(visit => JSON.stringify([visit.date, visit.time, visit.hospitalName])));
  return distinct.size === value.length && value.every((visit, index) => index === 0
    || value[index - 1].date + value[index - 1].time <= visit.date + visit.time);
}

/** Visits, like patient reminders, are local wall-clock times. */
export function isUpcomingVisit(visit: SharedVisit, now = new Date()): boolean {
  return Date.parse(`${visit.date}T${visit.time}:00`) > now.getTime();
}
