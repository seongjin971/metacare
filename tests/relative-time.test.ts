import assert from 'node:assert/strict';
import test from 'node:test';
import { relativeTime } from '../src/relative-time.ts';

test('recent times read as natural phrases and older ones as a date', () => {
  const now = Date.parse('2026-11-12T07:06:27.000Z');
  assert.equal(relativeTime('2026-11-12T07:06:00.000Z', now), '방금');
  assert.equal(relativeTime('2026-11-12T07:01:00.000Z', now), '5분 전');
  assert.equal(relativeTime('2026-11-12T04:00:00.000Z', now), '3시간 전');
  assert.match(relativeTime('2026-11-10T07:06:00.000Z', now) ?? '', /11월 10일/);
  assert.equal(relativeTime(undefined, now), null);
  assert.equal(relativeTime('not a date', now), null);
});
