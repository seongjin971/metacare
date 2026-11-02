export type NotificationRoute = '/' | '/appointments' | '/settings';

/** Accept only app destinations, including medication links sent before its tab was removed. */
export function resolveNotificationRoute(value: unknown): NotificationRoute | null {
  if (value === '/medicines') return '/';
  if (value === '/' || value === '/appointments' || value === '/settings') return value;
  return null;
}
