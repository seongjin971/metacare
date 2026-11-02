import assert from 'node:assert/strict';
import test from 'node:test';
import { photoFor } from './fixtures.ts';
import { createInitialState, ensureDailyDoses, recordDose, validateLoadedState, type Dose } from '../src/domain.ts';
import { dosesForHistoryDate, summarizeDosesByDate } from '../src/medication-history.ts';

const firstDay = new Date(2026, 9, 28, 8);
const nextDay = new Date(2026, 9, 29, 8);

test('calendar distinguishes partial, unrecorded and absent days while excluding future schedules', () => {
  let state = createInitialState(firstDay);
  state = recordDose(state, state.doses[0].id, true, firstDay, photoFor(firstDay));
  state = recordDose(state, state.doses[1].id, true, new Date(2026, 9, 28, 13), photoFor(new Date(2026, 9, 28, 13)));
  state = ensureDailyDoses(state, nextDay);
  state = ensureDailyDoses(state, new Date(2026, 9, 30, 8));
  const before = JSON.stringify(state.doses);
  const summary = summarizeDosesByDate(state.doses, '2026-10-29');

  assert.deepEqual(summary.get('2026-10-28'), { taken: 2, total: 3 });
  assert.deepEqual(summary.get('2026-10-29'), { taken: 0, total: 3 });
  assert.equal(summary.has('2026-10-27'), false);
  assert.equal(summary.has('2026-10-30'), false);
  assert.equal(summary.size, 2);
  assert.deepEqual(dosesForHistoryDate(state.doses, '2026-10-27', '2026-10-29'), []);
  assert.deepEqual(dosesForHistoryDate(state.doses, '2026-10-30', '2026-10-29'), []);
  assert.equal(JSON.stringify(state.doses), before);
});

test('history sorts a copied day selection without changing the input or recorded timestamps', () => {
  let state = createInitialState(firstDay);
  state = recordDose(state, state.doses[0].id, true, firstDay, photoFor(firstDay));
  const next = ensureDailyDoses(state, nextDay);
  const doses: readonly Dose[] = Object.freeze([next.doses[2], next.doses[3], next.doses[0], next.doses[1]]);
  const original = [...doses];
  const rows = dosesForHistoryDate(doses, '2026-10-28', '2026-10-29');

  assert.deepEqual(rows.map(dose => dose.time), ['08:00', '13:00', '19:00']);
  assert.equal(rows[0].takenAt, firstDay.toISOString());
  assert.deepEqual(doses, original);
  rows.reverse();
  assert.deepEqual(doses, original);
  assert.equal(rows.length, 3);
});

test('daily rollover and storage reload preserve history under the scheduled date, including late entries', () => {
  let state = createInitialState(firstDay);
  state = recordDose(state, state.doses[0].id, true, firstDay, photoFor(firstDay));
  state = recordDose(state, state.doses[1].id, true, new Date(2026, 9, 28, 13), photoFor(new Date(2026, 9, 28, 13)));
  const midnight = new Date(2026, 9, 29, 0, 5);
  state = ensureDailyDoses(state, midnight);
  state = recordDose(state, state.doses[2].id, true, midnight, photoFor(midnight));
  const stored = JSON.stringify(state);
  const restored = validateLoadedState(JSON.parse(stored));
  const today = ensureDailyDoses(restored, nextDay);
  const history = dosesForHistoryDate(today.doses, '2026-10-28', '2026-10-29');
  const summary = summarizeDosesByDate(today.doses, '2026-10-29');

  assert.equal(today, restored);
  assert.equal(history.length, 3);
  assert.equal(history[2].date, '2026-10-28');
  assert.equal(history[2].takenAt, midnight.toISOString());
  assert.deepEqual(summary.get('2026-10-28'), { taken: 3, total: 3 });
  assert.deepEqual(summary.get('2026-10-29'), { taken: 0, total: 3 });
  assert.deepEqual(today.doses, state.doses);
  assert.equal(JSON.stringify(restored), stored);
});
