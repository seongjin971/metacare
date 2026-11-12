import assert from 'node:assert/strict';
import test from 'node:test';
import { localDateKey, recordDose } from '../src/domain.ts';
import { restoreSampleMedication, serializeSampleMedication, withSampleMedicationHistory } from '../src/sample-medication-storage.ts';
import { photoFor } from './fixtures.ts';

test('reopening never overlays a fabricated completion on an observed day', () => {
  const today = new Date(2026, 10, 3, 12);
  const tomorrow = new Date(2026, 10, 4, 12);
  const initial = restoreSampleMedication(null, today);
  const history = withSampleMedicationHistory(initial, today);
  assert(history.doses.some(dose => dose.date < localDateKey(today) && dose.status === 'taken'));
  assert(initial.doses.every(dose => dose.date === localDateKey(today) && dose.status === 'pending'));
  assert.throws(() => serializeSampleMedication(history));

  const verified = recordDose(initial, initial.doses[0].id, true, today, photoFor(today));
  const saved = serializeSampleMedication(verified);
  assert.deepEqual(restoreSampleMedication(saved, today).doses, verified.doses);
  const nextDay = withSampleMedicationHistory(restoreSampleMedication(saved, tomorrow), tomorrow);
  assert.deepEqual(nextDay.doses.filter(dose => dose.date === localDateKey(today)), verified.doses);
  assert(nextDay.doses.filter(dose => dose.date === localDateKey(tomorrow)).every(dose => dose.status === 'pending'));

  const undone = recordDose(verified, initial.doses[0].id, false, today);
  assert.deepEqual(restoreSampleMedication(serializeSampleMedication(undone), today).doses, initial.doses);
});

test('completions without a photo are rejected on both write and restore; a photo without the pouch check is kept', () => {
  const today = new Date(2026, 10, 3, 12);
  const state = restoreSampleMedication(null, today);
  const { verification: _verification, ...stamped } = photoFor(today);
  const withPhoto = (photo: typeof stamped | undefined) => state.doses.map((dose, index) => index === 0
    ? { ...dose, status: 'taken' as const, takenAt: today.toISOString(), photo } : dose);
  const missing = withPhoto(undefined);
  assert.throws(() => serializeSampleMedication({ ...state, doses: missing }));
  assert.throws(() => restoreSampleMedication(JSON.stringify({ medicationSchedule: state.medicationSchedule, doses: missing }), today));
  const kept = withPhoto(stamped);
  assert.doesNotThrow(() => serializeSampleMedication({ ...state, doses: kept }));
});
