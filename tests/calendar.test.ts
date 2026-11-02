import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDays, isCalendarDate, shiftMonth, startOfMonth } from '../src/calendar.ts';

test('link dates reject impossible, abbreviated and repeated values', () => {
  assert.equal(isCalendarDate('2028-02-29'), true);
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01', '2026-10-28T00:00:00Z', ['2026-10-28'], undefined]) {
    assert.equal(isCalendarDate(value), false);
  }
});

test('month navigation starts on day one and crosses year boundaries', () => {
  assert.equal(startOfMonth('2026-10-31'), '2026-10-01');
  assert.equal(shiftMonth('2026-01-31', 1), '2026-02-01');
  assert.equal(shiftMonth('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftMonth('2027-01-01', -1), '2026-12-01');
  assert.throws(() => shiftMonth('2026-01-01', 0.5));
  assert.throws(() => shiftMonth('2026-02-30', 1));
});

test('calendar aligns weekdays and supports months spanning six weeks', () => {
  const days = calendarDays('2026-08-17');
  assert.equal(days.length, 42);
  assert.deepEqual(days.slice(0, 6), Array(6).fill(null));
  assert.equal(days[6], '2026-08-01');
  assert.equal(days[36], '2026-08-31');
  assert.ok(days.slice(37).every(day => day === null));
});

test('February uses leap-year rules without adding an unnecessary week', () => {
  assert.equal(calendarDays('2026-02-01').length, 28);
  assert.equal(calendarDays('2028-02-01').filter(Boolean).length, 29);
  assert.equal(calendarDays('1900-02-01').filter(Boolean).length, 28);
  assert.equal(calendarDays('2000-02-01').filter(Boolean).length, 29);
  assert.ok(calendarDays('2028-02-01').includes('2028-02-29'));
  assert.ok(!calendarDays('2028-02-01').includes('2028-03-01'));
});
