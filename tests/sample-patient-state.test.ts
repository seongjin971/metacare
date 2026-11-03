import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, hospitalNames, localDateKey, upcomingVisits, validateLoadedState } from '../src/domain.ts';
import { summarizeDosesByDate } from '../src/medication-history.ts';
import { createSamplePatientState } from '../src/sample-patient-state.ts';
import { makeDemoData } from '../caregiver/src/demo.ts';

test('sample history and visits survive restore with no photo, sharing or device reminders', () => {
  const now = new Date(2027, 0, 1, 20);
  const state = createSamplePatientState(now);
  assert.deepEqual(validateLoadedState(JSON.parse(JSON.stringify(state))), state);
  assert.deepEqual(createSamplePatientState(now), state);
  const days = summarizeDosesByDate(state.doses, '2027-01-01');
  assert.deepEqual([...days], [
    ['2026-12-29', { taken: 0, total: 3 }],
    ['2026-12-30', { taken: 1, total: 3 }],
    ['2026-12-31', { taken: 3, total: 3 }],
    ['2027-01-01', { taken: 0, total: 3 }],
  ]);
  assert(state.doses.every(dose => !dose.photo && (!dose.takenAt || new Date(dose.takenAt) <= now)));
  assert.deepEqual(state.sharing, { caregiver: false, hospital: false });
  assert(!state.reminders.appointment && !state.reminders.medication);
  assert.deepEqual(upcomingVisits(state, now), []);
  assert.deepEqual(state.visits.map(visit => [visit.date, visit.time]), [
    ['2026-12-30', '09:30'], ['2026-12-31', '15:10'],
  ]);
  assert.deepEqual(hospitalNames(state), state.visits.map(visit => visit.hospitalName));
});

test('patient and caregiver fixtures only contain completions from earlier local dates', () => {
  for (const now of [new Date(2026, 11, 31, 23, 59), new Date(2027, 0, 1), new Date(2027, 0, 1, 23, 59)]) {
    const today = localDateKey(now);
    const state = createSamplePatientState(now);
    assert.deepEqual(state.doses.filter(dose => dose.date === today), createInitialState(now).doses);
    const snapshot = makeDemoData(now).snapshot;
    assert(snapshot);
    assert.deepEqual(snapshot.doses.filter(dose => dose.date === today).map(dose => dose.time), snapshot.schedule.times);
    for (const doses of [state.doses, snapshot.doses]) {
      assert(doses.some(dose => dose.status === 'taken' && dose.date < today));
      assert(doses.every(dose => dose.date < today ||
        (dose.date === today && dose.status === 'pending' && !dose.takenAt && !dose.photo)));
    }
  }
});
