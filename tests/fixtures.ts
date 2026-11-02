import type { DosePhoto } from '../src/dose-photo.ts';

let photoSequence = 0;

/** Test metadata only; production photos come exclusively from the camera flow. */
export function photoFor(now: Date): DosePhoto {
  return { id: `photo-fixture-${++photoSequence}`, capturedAt: now.toISOString(), width: 640, height: 480,
    verification: { method: 'medicine-pouch-text-v1', checkedAt: now.toISOString() } };
}
