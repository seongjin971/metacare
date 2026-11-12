import assert from 'node:assert/strict';
import test from 'node:test';
import { photoStampLabel } from '../src/photo-stamp-label.ts';

test('the photo stamp shows the date, weekday and a 12-hour Korean time', () => {
  assert.equal(photoStampLabel(new Date(2026, 10, 12, 19, 3)), '메타케어 · 2026.11.12 (목) 오후 7:03');
  assert.equal(photoStampLabel(new Date(2026, 0, 4, 0, 5)), '메타케어 · 2026.01.04 (일) 오전 12:05');
  assert.equal(photoStampLabel(new Date(2026, 0, 4, 12, 0)), '메타케어 · 2026.01.04 (일) 오후 12:00');
  assert.throws(() => photoStampLabel(new Date('invalid')));
});
