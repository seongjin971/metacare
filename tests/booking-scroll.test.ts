import assert from 'node:assert/strict';
import test from 'node:test';
import { preservedBookingOffset } from '../src/booking-scroll.ts';

test('adding the first or another appointment keeps the same form point on screen', () => {
  for (const previousAnchorY of [0, 140]) {
    const scrollY = previousAnchorY + 400;
    const nextAnchorY = previousAnchorY + 77;
    const nextScrollY = preservedBookingOffset({ scrollY, previousAnchorY, nextAnchorY, contentHeight: 1800, viewportHeight: 700 });
    assert.equal(nextScrollY, scrollY + 77);
    assert.equal(nextAnchorY - nextScrollY!, previousAnchorY - scrollY);
  }
});

test('removing appointments preserves the form position, including removal of the entire list', () => {
  for (const nextAnchorY of [140, 0]) {
    const nextScrollY = preservedBookingOffset({ scrollY: 600, previousAnchorY: 240, nextAnchorY, contentHeight: 1600, viewportHeight: 700 });
    assert.equal(nextAnchorY - nextScrollY!, 240 - 600);
  }
});

test('a cancellation while reading the appointment list does not pull the form into view', () => {
  assert.equal(preservedBookingOffset({ scrollY: 80, previousAnchorY: 240, nextAnchorY: 0, contentHeight: 1400, viewportHeight: 700 }), null);
});

test('changes below the form anchor do not trigger restoration', () => {
  assert.equal(preservedBookingOffset({ scrollY: 600, previousAnchorY: 140, nextAnchorY: 140, contentHeight: 1000, viewportHeight: 700 }), null);
});

test('restoration respects the new scroll range after content or viewport changes', () => {
  assert.equal(preservedBookingOffset({ scrollY: 600, previousAnchorY: 240, nextAnchorY: 0, contentHeight: 900, viewportHeight: 700 }), 200);
  assert.equal(preservedBookingOffset({ scrollY: 100, previousAnchorY: 0, nextAnchorY: 140, contentHeight: 600, viewportHeight: 700 }), 0);
});

test('unmeasured or invalid dimensions never produce a scroll command', () => {
  const input = { scrollY: 400, previousAnchorY: 0, nextAnchorY: 140, contentHeight: 1500, viewportHeight: 700 };
  assert.equal(preservedBookingOffset({ ...input, contentHeight: 0 }), null);
  assert.equal(preservedBookingOffset({ ...input, viewportHeight: 0 }), null);
  assert.equal(preservedBookingOffset({ ...input, nextAnchorY: NaN }), null);
});
