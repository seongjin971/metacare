import type { DevicePushToken } from 'expo-notifications';
import { careRequest } from '../../shared/care-api';

export const supportsCareAlerts = typeof window !== 'undefined' && window.isSecureContext
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function hasAlertPermission(ask: boolean): Promise<boolean> {
  if (!supportsCareAlerts) return Promise.resolve(false);
  if (ask && Notification.permission === 'default') {
    return Notification.requestPermission().then(value => value === 'granted');
  }
  return Promise.resolve(Notification.permission === 'granted');
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('브라우저 알림 서비스에 연결하지 못했어요. 다시 시도해 주세요.')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export async function getAlertToken(_rotated?: DevicePushToken): Promise<string> {
  if (!supportsCareAlerts || Notification.permission !== 'granted') throw new Error('브라우저의 알림을 허용해 주세요.');
  const [{ applicationServerKey }, registration] = await Promise.all([
    careRequest<{ applicationServerKey: string }>('/v1/web-push/key'),
    timeout(navigator.serviceWorker.register('/care-alert-worker.js', { scope: '/' })
      .then(() => navigator.serviceWorker.ready), 15000),
  ]);
  const key = Uint8Array.from(atob(applicationServerKey.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
  let subscription = await timeout(registration.pushManager.getSubscription(), 8000);
  const oldKey = subscription?.options.applicationServerKey;
  if (subscription && oldKey && (oldKey.byteLength !== key.length || !key.every((value, i) => new Uint8Array(oldKey)[i] === value))) {
    await timeout(subscription.unsubscribe(), 8000); subscription = null;
  }
  subscription ??= await timeout(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), 20000);
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.auth || !keys.p256dh) throw new Error('브라우저의 알림 등록 정보를 읽지 못했어요.');
  return 'webpush:' + JSON.stringify({ endpoint, keys: { auth: keys.auth, p256dh: keys.p256dh } });
}

export function watchAlertToken(_onChange: (token: DevicePushToken) => void) {
  // Browsers do not provide Expo device tokens. Refresh the subscription on return to the app.
  return { remove() {} };
}

type WebTap = { notification: { date: number; request: { identifier: string; content: { data: Record<string, unknown> } } } };
const prefix = '#care-alert=';

export function watchAlertTaps(onTap: (value: WebTap) => void) {
  function read() {
    const hash = window.location.hash;
    if (!hash.startsWith(prefix) || hash.length > 1024) return;
    try {
      const data = JSON.parse(decodeURIComponent(hash.slice(prefix.length)));
      if (data && typeof data === 'object' && data.type === 'overdue-dose')
        onTap({ notification: { date: 0, request: { identifier: [data.connectedAt, data.date, data.time].join('/'), content: { data } } } });
    } catch { /* An invalid fragment is never a navigation instruction. */ }
    consumeAlertTap();
  }
  window.addEventListener('hashchange', read);
  read();
  return { remove() { window.removeEventListener('hashchange', read); } };
}

export function consumeAlertTap() {
  if (window.location.hash.startsWith(prefix)) history.replaceState(history.state, '', window.location.pathname + window.location.search);
}

export function clearDeliveredAlerts() {
  if (!supportsCareAlerts) return;
  consumeAlertTap();
  void navigator.serviceWorker.getRegistration('/').then(async registration => {
    for (const item of await registration?.getNotifications() ?? []) item.close();
  }).catch(() => undefined);
}
