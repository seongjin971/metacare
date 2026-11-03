/* global self */
// Push delivery only. Never intercept requests or cache patient records or photos.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function dose(data) {
  if (!data || data.type !== 'overdue-dose' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.time) || typeof data.connectedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.connectedAt)) return null;
  return { type: 'overdue-dose', date: data.date, time: data.time, connectedAt: data.connectedAt };
}

self.addEventListener('push', event => {
  let data;
  try { data = dose(event.data?.json()?.data); } catch { return; }
  if (!data) return;
  event.waitUntil(self.registration.showNotification('복약 기록 확인', {
    body: data.time + ' 복약 기록이 아직 없어요.', icon: '/care-icon-192.png',
    tag: [data.connectedAt, data.date, data.time].join('/'), data,
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = dose(event.notification.data);
  if (!data) return;
  const legacy = new URL(self.location.href).searchParams.get('layout') === 'standalone';
  const url = new URL(legacy ? '/' : '/caregiver', self.location.origin);
  // The fragment is never sent to the web host. The app checks the current pairing before opening history.
  url.hash = 'care-alert=' + encodeURIComponent(JSON.stringify(data));
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find(client => new URL(client.url).origin === url.origin);
    if (tab) {
      try { const target = await tab.navigate(url.href); if (target) { await target.focus(); return; } } catch { /* Closed meanwhile. */ }
    }
    await self.clients.openWindow(url.href);
  })());
});
