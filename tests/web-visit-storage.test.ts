import assert from 'node:assert/strict';
import test from 'node:test';
import { addVisit, createInitialState, removeVisit, setReminderOffsets } from '../src/domain.ts';
import { withNewerVisits, writeWebState } from '../src/web-visit-storage.ts';

test('two stale tabs retain independent visit edits, and an unrelated later save cannot resurrect a deletion', async t => {
  const data = new Map<string, string>();
  const key = 'test-patient';
  const localStorage = {
    getItem: (name: string) => data.get(name) ?? null,
    setItem: (name: string, value: string) => { data.set(name, value); },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { navigator, localStorage } });
  t.after(() => { Reflect.deleteProperty(globalThis, 'window'); });
  const now = new Date(2026, 10, 2, 8);
  const original = createInitialState(now);
  const first = { hospitalName: '시연 병원 A', date: '2026-11-04', time: '10:15' };
  const second = { hospitalName: '시연 병원 B', date: '2026-11-05', time: '12:37' };
  const [a, b] = await Promise.all([
    writeWebState(key, original, current => addVisit(current, first, now)),
    writeWebState(key, original, current => addVisit(current, second, now)),
  ]);
  const both = JSON.parse(data.get(key)!);
  assert.equal(both.visits.length, 2);
  const firstId = a.visits.find(visit => visit.hospitalName === first.hospitalName)!.id;
  const removed = await writeWebState(key, a, current => removeVisit(current, firstId, now));
  assert.deepEqual(removed.visits.map(visit => visit.hospitalName), [second.hospitalName]);

  const unrelated = setReminderOffsets(b, 'medication', [17]);
  const final = await writeWebState(key, unrelated);
  assert.deepEqual(final.visits, removed.visits);
  assert.equal(final.visitsRevision, removed.visitsRevision);
  assert.deepEqual(final.reminders.medicationMinutesBefore, [17]);
  assert.deepEqual(withNewerVisits(b, removed).visits, removed.visits);
  assert.equal(withNewerVisits(final, a), final);
});
