import assert from 'node:assert/strict';
import test from 'node:test';
import type { CareSnapshot } from '../shared/care-types.ts';
import { eligibleOverdueSlot, nextOverdueSlot, parseOverdueSettings, RetryablePushError, sendOverduePush } from '../server/overdue.ts';

const snapshot: CareSnapshot = {
  patientName: '환자', schedule: { frequency: 'once', times: ['08:00'] },
  // Last uploaded well before the tested days, so their slots follow the recurring schedule.
  doses: [], updatedAt: '2026-01-01T00:00:00.000Z', timeZone: 'Asia/Seoul',
};
const slot = { date: '2026-11-02', time: '08:00', dueAt: Date.parse('2026-11-01T23:30:00Z') };

test('future scheduled doses are checked even if neither app has opened that day', () => {
  assert.deepEqual(nextOverdueSlot(snapshot, 30, slot.dueAt - 1, 'Europe/Paris'), slot);
  assert.equal(eligibleOverdueSlot(snapshot, 30, slot, slot.dueAt - 1), false);
  assert.equal(eligibleOverdueSlot(snapshot, 30, slot, slot.dueAt), true);
  const next = nextOverdueSlot(snapshot, 30, slot.dueAt);
  assert.equal(next?.date, '2026-11-03');
  const lateNight = { ...snapshot, schedule: { ...snapshot.schedule, times: ['23:50'] } };
  assert.deepEqual(nextOverdueSlot(lateNight, 30, Date.parse('2026-11-02T00:12:00+09:00')), {
    date: '2026-11-01', time: '23:50', dueAt: Date.parse('2026-11-02T00:20:00+09:00'),
  });
});

test('patient day rows win over recurring times and a received record cancels that slot', () => {
  const dose = { id: 'morning', date: slot.date, time: slot.time, label: '아침 약', status: 'taken' as const };
  const received = { ...snapshot, doses: [dose] };
  assert.equal(eligibleOverdueSlot(received, 30, slot, slot.dueAt), false);
  assert.equal(eligibleOverdueSlot(snapshot, 60, slot, slot.dueAt), false);
  assert.equal(eligibleOverdueSlot({ ...snapshot, schedule: { ...snapshot.schedule, times: ['09:00'] } }, 30, slot, slot.dueAt), false);
  const preservedToday = { ...snapshot, doses: [{ ...dose, time: '09:00', status: 'pending' as const }] };
  assert.equal(nextOverdueSlot(preservedToday, 30, slot.dueAt - 1)?.time, '09:00');
  assert.equal(eligibleOverdueSlot(preservedToday, 30, slot, slot.dueAt), false);
});

test('on a clock change the slot fires once using the first repeated wall time or the end of the gap', () => {
  const ny = { ...snapshot, timeZone: 'America/New_York', schedule: { ...snapshot.schedule, times: ['01:30'] } };
  const fallBack = nextOverdueSlot(ny, 30, Date.parse('2026-11-01T02:00Z'))!;
  assert.equal(fallBack.dueAt, Date.parse('2026-11-01T06:00Z'));
  assert.equal(nextOverdueSlot(ny, 30, fallBack.dueAt)?.date, '2026-11-02');
  const spring = { ...ny, schedule: { ...ny.schedule, times: ['02:30'] } };
  assert.equal(nextOverdueSlot(spring, 30, Date.parse('2026-03-08T06:00Z'))?.dueAt, Date.parse('2026-03-08T08:00Z'));
  const adjacent = { ...ny, schedule: { frequency: 'twice' as const, times: ['02:30', '03:30'] } };
  const first = nextOverdueSlot(adjacent, 30, Date.parse('2026-03-08T06:00Z'))!;
  assert.equal(first.time, '02:30');
  assert.equal(nextOverdueSlot(adjacent, 30, first.dueAt + 60_000, undefined, first)?.time, '03:30');
  assert.equal(nextOverdueSlot(adjacent, 30, first.dueAt + 61 * 60_000, undefined, first)?.date, '2026-03-09');
});

test('Expo payload points to a dose in the correct pairing and explicit recipient/rate errors are classified', async t => {
  const token = 'ExpoPushToken[abcdefgh12345]';
  const connectedAt = '2026-11-01T00:00:00.000Z';
  let reply = Response.json({ data: { status: 'ok', id: 'ticket-123' } });
  const fetcher = t.mock.method(globalThis, 'fetch', async () => reply);
  assert.equal(await sendOverduePush(token, slot, connectedAt), 'accepted');
  const request = fetcher.mock.calls[0].arguments as unknown as [string, RequestInit];
  const payload = JSON.parse(String(request[1].body));
  assert.deepEqual(payload.data, { type: 'care-overdue', date: slot.date, time: slot.time, connectedAt });
  // Lock screens show only generic text; the dose time stays in the data payload.
  assert.deepEqual([payload.title, payload.body], ['메타케어', '확인할 복약 기록이 있어요.']);
  assert.equal(payload.channelId, 'caregiver-overdue');
  reply = Response.json({ data: { status: 'error', details: { error: 'DeviceNotRegistered' } } });
  assert.equal(await sendOverduePush(token, slot, connectedAt), 'unregistered');
  reply = new Response(null, { status: 429 });
  await assert.rejects(() => sendOverduePush(token, slot, connectedAt), RetryablePushError);
  assert.throws(() => parseOverdueSettings({ enabled: true, threshold: 30, expoPushToken: 'abc' }));
  assert.throws(() => parseOverdueSettings({ enabled: true, threshold: 30, expoPushToken: token, timeZone: 'not-a-time-zone' }));
});

test('a day the patient app uploaded with no rows has nothing due, but the next day follows the schedule', () => {
  // A new patient finished setup at 21:00 KST after the last dose, so today has no rows.
  const lateSetup: CareSnapshot = { ...snapshot, schedule: { frequency: 'twice', times: ['08:00', '19:00'] },
    updatedAt: '2026-11-12T12:00:00.000Z' };
  const next = nextOverdueSlot(lateSetup, 120, Date.parse('2026-11-12T12:00:00.000Z'));
  assert.deepEqual(next, { date: '2026-11-13', time: '08:00', dueAt: Date.parse('2026-11-13T01:00:00.000Z') });
  const evening = { date: '2026-11-12', time: '19:00', dueAt: Date.parse('2026-11-12T12:00:00.000Z') };
  assert.equal(eligibleOverdueSlot(lateSetup, 120, evening, evening.dueAt), false);
});
