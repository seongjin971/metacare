import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveNotificationRoute } from '../src/notification-routes.ts';

test('old medication notification links open Home after its tab is removed', () => {
  assert.equal(resolveNotificationRoute('/medicines'), '/');
  for (const route of ['/', '/appointments', '/settings']) {
    assert.equal(resolveNotificationRoute(route), route);
  }
});

test('notification links cannot open external or unknown destinations', () => {
  for (const value of [
    undefined, null, 1, {}, { pathname: '/' },
    'https://example.com', '//example.com', 'metacare://medicines',
    '/consultation', '/medicines?url=https://example.com',
    '/settings/../medicines', '/medicines/', '',
  ]) {
    assert.equal(resolveNotificationRoute(value), null);
  }
});
