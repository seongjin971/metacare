import type { SharedVisit } from './care-types.ts';

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

/** Visits, like patient reminders, are local wall-clock times. */
export function isUpcomingVisit(visit: SharedVisit, now = new Date()): boolean {
  return Date.parse(`${visit.date}T${visit.time}:00`) > now.getTime();
}
