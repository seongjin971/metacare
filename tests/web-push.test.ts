import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import webPush from 'web-push';
import { RetryablePushError } from '../server/care-errors.ts';
import { parseWebPushSubscription, sendWebOverduePush } from '../server/web-push.ts';

const receiver = createECDH('prime256v1');
const keys = { p256dh: receiver.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') };
const endpoint = 'https://fcm.googleapis.com/fcm/send/example';
const slot = { date: '2026-11-03', time: '10:00' };
const connectedAt = '2026-11-01T00:00:00.000Z';

test('browser subscriptions serialize identically across browsers and exclude unrelated fields', () => {
  for (const address of [endpoint, 'https://fcm.googleapis.com/wp/example', 'https://updates.push.services.mozilla.com/wpush/v2/example==', 'https://web.push.apple.com/example',
    'https://wns2-par02p.notify.windows.com/w/?token=YW%2bB%2FA%3d%3D', 'https://wns2-pn1p.notify.windows.com/w?token=YmFzZQ==']) {
    const json = JSON.stringify({ keys: { auth: keys.auth, p256dh: keys.p256dh }, endpoint: address, expirationTime: null, extra: 'omit' });
    const canonical = parseWebPushSubscription(json);
    assert.ok(canonical === 'webpush:' + JSON.stringify({ endpoint: address, keys }));
    assert.ok(parseWebPushSubscription(canonical) === canonical);
  }
});

test('registration rejects private hosts, misleading authorities, alternate routes, invalid points and oversized tokens', () => {
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/example', 'https://127.0.0.1/x', 'https://[::1]/x',
    'https://fcm.googleapis.com.evil.invalid/fcm/send/x', 'https://fcm.googleapis.com@evil.invalid/fcm/send/x',
    'https://evil@fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com:443/fcm/send/x',
    endpoint + '?redirect=https://127.0.0.1/', endpoint + '#fragment', endpoint + '\n',
    'https://fcm.googleapis.com/fcm/send/..', 'https://fcm.googleapis.com/fcm/send/%2e%2e',
    'https://fcm.googleapis.com/v1/projects/elsewhere/messages:send', 'https://web.push.apple.com/' + 'x'.repeat(2150),
    'https://wns2-a.notify.windows.com.attacker.example/w?token=abc',
    'https://host.wns2-a.notify.windows.com/w?token=abc', 'https://wns2-a.notify.windows.com:442/w?token=abc',
    'https://wns2-a.notify.windows.com/w/extra?token=abc', 'https://wns2-a.notify.windows.com//w?token=abc',
    'https://wns2-a.notify.windows.com/w?token=abc&token=def', 'https://wns2-a.notify.windows.com/w?token=abc%26next%3Dxyz',
    'https://wns2-a.notify.windows.com/w?token=abc%0d%0a', 'https://wns2-a.notify.windows.com/w?next=abc',
  ]) {
    assert.throws(() => parseWebPushSubscription(JSON.stringify({ endpoint: bad, keys })));
  }
  const offCurve = Buffer.concat([Buffer.of(4), Buffer.alloc(64)]).toString('base64url');
  for (const broken of [{ ...keys, auth: 'abc' }, { ...keys, p256dh: offCurve }, { ...keys, auth: keys.auth + '=' }]) {
    assert.throws(() => parseWebPushSubscription(JSON.stringify({ endpoint, keys: broken })));
  }
});

test('the provider receives encrypted content, and only explicit rate refusals are safe to retry', async t => {
  const vapid = webPush.generateVAPIDKeys();
  const previousPublic = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const previousPrivate = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = vapid.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = vapid.privateKey;
  t.after(() => {
    if (previousPublic === undefined) delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    else process.env.WEB_PUSH_VAPID_PUBLIC_KEY = previousPublic;
    if (previousPrivate === undefined) delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    else process.env.WEB_PUSH_VAPID_PRIVATE_KEY = previousPrivate;
  });
  let status = 201;
  let request: RequestInit | undefined;
  t.mock.method(globalThis, 'fetch', async (destination: string, init: RequestInit) => {
    assert.ok(destination === endpoint);
    request = init;
    return new Response(null, { status });
  });
  const registered = parseWebPushSubscription(JSON.stringify({ endpoint, keys }));
  const send = () => sendWebOverduePush(registered, slot, connectedAt);
  assert.equal(await send(), 'accepted');
  assert.equal(request?.redirect, 'error');
  const headers = new Headers(request?.headers);
  assert.equal(headers.get('content-encoding'), 'aes128gcm');
  assert.ok(headers.get('authorization')?.startsWith('vapid '));
  // Decrypt as the test subscriber using the same RFC 8291 codec shipped by web-push.
  const require = createRequire(import.meta.url);
  const ece = createRequire(require.resolve('web-push'))('http_ece');
  const clear = ece.decrypt(Buffer.from(request?.body as Uint8Array), { version: 'aes128gcm', privateKey: receiver, authSecret: Buffer.from(keys.auth, 'base64url') });
  assert.deepEqual(JSON.parse(clear.toString()), { title: '복약 기록 확인', body: '10:00 복약 기록이 아직 없어요.', data: { type: 'overdue-dose', ...slot, connectedAt } });
  for (status of [404, 410]) assert.equal(await send(), 'unregistered');
  status = 429; await assert.rejects(send, RetryablePushError);
  for (status of [307, 403, 503]) await assert.rejects(send, e => e instanceof Error && !(e instanceof RetryablePushError));
});
