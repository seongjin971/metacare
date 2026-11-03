import { ECDH } from 'node:crypto';
import webPush, { type PushSubscription } from 'web-push';
import { RetryablePushError } from './care-errors.ts';

const prefix = 'webpush:';
const vapidSubject = 'https://metacare-caregiver-test.vercel.app/';
// Match the full provider delivery route. WNS embeds the subscription in a single
// base64 query parameter, sometimes percent-encoding '+', '/' and '='.
const providerRoute = /^https:\/\/(?:fcm\.googleapis\.com\/(?:fcm\/send|wp)|updates\.push\.services\.mozilla\.com\/wpush\/v[12]|web\.push\.apple\.com)\/[A-Za-z0-9_:=-]+$/;
const windowsRoute = /^https:\/\/wns2-[a-z0-9]{1,16}\.notify\.windows\.com\/w\/?\?token=(?:[A-Za-z0-9+/]|%2[BbFf])+(?:=|%3[Dd]){0,2}$/;

function invalid(): never { throw new Error('올바른 브라우저 알림 구독이 필요해요.'); }

function keyBytes(value: unknown, length: number) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return invalid();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== length || bytes.toString('base64url') !== value) return invalid();
  return bytes;
}

function subscription(input: string): PushSubscription {
  if (typeof input !== 'string' || Buffer.byteLength(input) > 2400) return invalid();
  let raw;
  try { raw = JSON.parse(input.startsWith(prefix) ? input.slice(prefix.length) : input); }
  catch { return invalid(); }
  const endpoint = raw?.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > 2048 || !(providerRoute.test(endpoint) || windowsRoute.test(endpoint))
    || new URL(endpoint).href !== endpoint) return invalid();
  const dh = keyBytes(raw.keys?.p256dh, 65);
  if (dh[0] !== 4) return invalid();
  try { ECDH.convertKey(dh, 'prime256v1'); } catch { return invalid(); }
  const auth = keyBytes(raw.keys?.auth, 16);
  return { endpoint, keys: { p256dh: dh.toString('base64url'), auth: auth.toString('base64url') } };
}

export function parseWebPushSubscription(input: string): string {
  return prefix + JSON.stringify(subscription(input));
}

export async function sendWebOverduePush(token: string, slot: { date: string; time: string }, connectedAt: string):
Promise<'accepted' | 'unregistered'> {
  const target = subscription(token);
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new Error('Web Push is not configured.');
  const payload = { title: '복약 기록 확인', body: slot.time + ' 복약 기록이 아직 없어요.',
    data: { type: 'overdue-dose', date: slot.date, time: slot.time, connectedAt } };
  const request = webPush.generateRequestDetails(target, JSON.stringify(payload), {
    vapidDetails: { subject: vapidSubject, publicKey, privateKey }, contentEncoding: 'aes128gcm', urgency: 'high', TTL: 3600,
  });
  let response: Response;
  try {
    response = await fetch(target.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(7500),
      headers: request.headers, body: new Uint8Array(request.body) });
  } catch { throw new Error('Web Push delivery could not be confirmed.'); }
  // A provider's response can contain the capability URL. Never log or persist it.
  void response.body?.cancel().catch(() => undefined);
  if (response.status === 404 || response.status === 410) return 'unregistered';
  if (response.status === 429) throw new RetryablePushError('Web Push rate limited.');
  if (!response.ok) throw new Error('Web Push rejected the request (' + response.status + ').');
  return 'accepted';
}
