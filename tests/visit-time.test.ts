import assert from 'node:assert/strict';
import test from 'node:test';
import { formatClockTime, parseClockNumber, toClockTime } from '../src/clock-time.ts';
import { suggestedVisitTime } from '../src/visit-time.ts';

test('the picker opens at a useful time on the selected date, including late at night', () => {
  const now = new Date(2026, 10, 3, 14, 22);
  assert.equal(suggestedVisitTime(true, now), '14:25');
  assert.equal(suggestedVisitTime(false, now), '09:00');
  assert.equal(suggestedVisitTime(true, new Date(2026, 10, 3, 23, 57)), '23:59');
});

test('visit times round-trip between Korean AM/PM and stored wall-clock time', () => {
  for (const [period, hour, minute, stored, shown] of [
    ['오전', '12', '0', '00:00', '오전 12:00'],
    ['오전', '09', '05', '09:05', '오전 9:05'],
    ['오후', '12', '15', '12:15', '오후 12:15'],
    ['오후', '1', '5', '13:05', '오후 1:05'],
    ['오후', '11', '59', '23:59', '오후 11:59'],
  ] as const) {
    assert.equal(toClockTime(period, hour, minute), stored);
    assert.equal(formatClockTime(stored), shown);
  }
});

test('incomplete inputs and 24-hour entries cannot accidentally create a visit', () => {
  for (const [hour, minute] of [['', '00'], ['12', ''], ['00', '01'], ['13', '00'], ['12', '60']]) {
    assert.equal(toClockTime('오후', hour, minute), null);
  }
});

test('typing uses the same clock range as the wheel and never truncates an invalid entry', () => {
  assert.equal(parseClockNumber('hour', '01'), 1);
  assert.equal(parseClockNumber('minute', '0'), 0);
  for (const input of ['', ' ', '-1', '1.5', '1e1', '123']) {
    assert.equal(parseClockNumber('hour', input), null);
    assert.equal(parseClockNumber('minute', input), null);
  }
});
