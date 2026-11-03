import type { DevicePushToken } from 'expo-notifications';
import Constants from 'expo-constants';
import { careRequest } from '../../shared/care-api';
import { clearCareAlertLaunch, takeCareAlertLaunch } from '../../src/care-alert-launch.web';

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
  const worker = Constants.expoConfig?.slug === 'metacare-caregiver' ? '/care-alert-worker.js?layout=standalone' : '/care-alert-worker.js';
  const [{ applicationServerKey }, registration] = await Promise.all([
    careRequest<{ applicationServerKey: string }>('/v1/web-push/key'),
    timeout(navigator.serviceWorker.register(worker, { scope: '/' })
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

export function watchAlertTaps(onTap: (value: WebTap) => void) {
  function read() {
    const data = takeCareAlertLaunch();
    if (data) onTap({ notification: { date: 0, request: { identifier: [data.connectedAt, data.date, data.time].join('/'), content: { data } } } });
  }
  window.addEventListener('hashchange', read);
  read();
  return { remove() { window.removeEventListener('hashchange', read); } };
}

export function consumeAlertTap() {
  clearCareAlertLaunch();
}

export function clearDeliveredAlerts() {
  if (!supportsCareAlerts) return;
  consumeAlertTap();
  void navigator.serviceWorker.getRegistration('/').then(async registration => {
    for (const item of await registration?.getNotifications() ?? []) item.close();
  }).catch(() => undefined);
}
