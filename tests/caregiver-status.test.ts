import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDoseState, summarizeDoses, isSnapshotStale } from '../caregiver/src/care-status.ts';
import type { SharedDose } from '../shared/care-types.ts';

const dose: SharedDose = { id: 'dose-a', date: '2026-11-01', time: '13:00', label: '점심 복용약', status: 'pending' };
const clock = (hour: number, minute: number, second = 0) => new Date(2026, 10, 1, hour, minute, second);

test('future doses are scheduled, due doses wait until the selected attention interval', () => {
  assert.equal(getDoseState(dose, 30, clock(12, 59, 59)), 'scheduled');
  assert.equal(getDoseState(dose, 30, clock(13, 0)), 'waiting');
  assert.equal(getDoseState(dose, 30, clock(13, 29, 59)), 'waiting');
  assert.equal(getDoseState(dose, 30, clock(13, 30)), 'overdue');
  assert.equal(getDoseState(dose, 60, clock(13, 30)), 'waiting');
});

test('a recorded dose remains recorded, not overdue; no invented completion for empty dates', () => {
  const recorded: SharedDose = { ...dose, status: 'taken', takenAt: clock(13, 5).toISOString() };
  assert.equal(getDoseState(recorded, 30, clock(16, 0)), 'recorded');
  assert.deepEqual(summarizeDoses([], 30, clock(16, 0)), { total: 0, recorded: 0, overdue: 0, waiting: 0, scheduled: 0, unknown: 0 });
  const result = summarizeDoses([recorded, { ...dose, id: 'pending' }, { ...dose, id: 'evening', time: '19:00' }], 30, clock(16, 0));
  assert.equal(result.recorded, 1);
  assert.equal(result.overdue, 1);
  assert.equal(result.scheduled, 1);
});

test('invalid dates and times cannot become missed-dose warnings', () => {
  assert.equal(getDoseState({ ...dose, date: '2026-02-30' }, 30, clock(16, 0)), 'unknown');
  assert.equal(getDoseState({ ...dose, time: '25:00' }, 30, clock(16, 0)), 'unknown');
  assert.equal(getDoseState(dose, 30, new Date('invalid')), 'unknown');
});

test('staleness distinguishes patient upload age from caregiver fetch age', () => {
  const now = clock(13, 10);
  assert.equal(isSnapshotStale(clock(13, 9).toISOString(), clock(13, 10).toISOString(), now), false);
  assert.equal(isSnapshotStale(clock(13, 4).toISOString(), clock(13, 10).toISOString(), now), true);
  assert.equal(isSnapshotStale(clock(13, 9).toISOString(), clock(13, 9).toISOString(), now), true);
  assert.equal(isSnapshotStale(null, clock(13, 10).toISOString(), now), true);
  assert.equal(isSnapshotStale(clock(13, 9).toISOString(), null, now), true);
});
