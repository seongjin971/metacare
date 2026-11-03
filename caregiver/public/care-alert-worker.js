/* global self */
// Retire subscriptions from earlier installations when their worker updates.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const subscription = await self.registration.pushManager?.getSubscription();
      await subscription?.unsubscribe();
    } finally {
      await self.registration.unregister();
    }
  })());
});
