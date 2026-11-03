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

test('unverified new completions are rejected on both write and restore', () => {
  const today = new Date(2026, 10, 3, 12);
  const state = restoreSampleMedication(null, today);
  const photo = photoFor(today);
  for (const invalid of [undefined, { ...photo, verification: undefined }]) {
    const doses = state.doses.map((dose, index) => index === 0
      ? { ...dose, status: 'taken' as const, takenAt: today.toISOString(), photo: invalid } : dose);
    assert.throws(() => serializeSampleMedication({ ...state, doses }));
    assert.throws(() => restoreSampleMedication(JSON.stringify({ medicationSchedule: state.medicationSchedule, doses }), today));
  }
});
