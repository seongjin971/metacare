import assert from 'node:assert/strict';
import test from 'node:test';
import { photoFor } from './fixtures.ts';
import {
  createInitialState, ensureDailyDoses, recordDose, setMedicationSchedule,
  setReminderOffsets, validateLoadedState,
} from '../src/domain.ts';
import { plannedReminders } from '../src/reminder-plan.ts';

const morning = new Date(2026, 9, 28, 6);

function withMedicationReminders() {
  const state = setReminderOffsets(createInitialState(morning), 'medication', [10, 0]);
  return { ...state, reminders: { ...state.reminders, medication: true } };
}

test('changing to once daily replaces old alarm IDs and keeps selected advance reminders', () => {
  const original = withMedicationReminders();
  const oldPlan = plannedReminders(original, morning.getTime());
  const changed = setMedicationSchedule(original, { frequency: 'once', times: ['10:20'] }, morning);
  const plan = plannedReminders(changed, morning.getTime());

  assert.equal(oldPlan.length, 6);
  assert.deepEqual(plan.map(item => item.at), [
    new Date(2026, 9, 28, 10, 10).getTime(),
    new Date(2026, 9, 28, 10, 20).getTime(),
  ]);
  assert.equal(new Set(plan.map(item => item.entityId)).size, 1);
  assert.ok(plan.every(item => item.url === '/' && !oldPlan.some(old => old.id === item.id)));
  assert.deepEqual(changed.reminders.medicationMinutesBefore, [10, 0]);
  assert.equal(changed.reminders.medication, true);
  assert.deepEqual(original.doses.map(dose => dose.time), ['08:00', '13:00', '19:00']);
});

test('morning and evening settings schedule both custom times after persistence', () => {
  const changed = setMedicationSchedule(withMedicationReminders(), {
    frequency: 'twice', times: ['08:30', '20:10'],
  }, morning);
  const loaded = ensureDailyDoses(validateLoadedState(JSON.parse(JSON.stringify(changed))), morning);
  const plan = plannedReminders(loaded, morning.getTime());

  assert.deepEqual(plan.map(item => item.at), [
    new Date(2026, 9, 28, 8, 20).getTime(),
    new Date(2026, 9, 28, 8, 30).getTime(),
    new Date(2026, 9, 28, 20).getTime(),
    new Date(2026, 9, 28, 20, 10).getTime(),
  ]);
  assert.equal(new Set(plan.map(item => item.entityId)).size, 2);
  assert.equal(loaded.doses.length, 2);
  assert.deepEqual(loaded.medicationSchedule, changed.medicationSchedule);
});

test('recorded day retains remaining alarms and next day uses the newly saved schedule', () => {
  const recordedAt = new Date(2026, 9, 28, 8, 5);
  const initial = withMedicationReminders();
  const recorded = recordDose(initial, initial.doses[0].id, true, recordedAt, photoFor(recordedAt));
  const remainingPlan = plannedReminders(recorded, recordedAt.getTime());
  const changed = setMedicationSchedule(recorded, { frequency: 'once', times: ['21:45'] }, recordedAt);

  assert.equal(remainingPlan.length, 4);
  assert.deepEqual(changed.doses, recorded.doses);
  assert.deepEqual(plannedReminders(changed, recordedAt.getTime()), remainingPlan);

  const tomorrow = new Date(2026, 9, 29, 6);
  const rolled = ensureDailyDoses(validateLoadedState(JSON.parse(JSON.stringify(changed))), tomorrow);
  const nextPlan = plannedReminders(rolled, tomorrow.getTime());
  assert.deepEqual(rolled.doses.filter(dose => dose.date === '2026-10-28'), recorded.doses);
  assert.deepEqual(rolled.doses.filter(dose => dose.date === '2026-10-29').map(dose => dose.time), ['21:45']);
  assert.deepEqual(nextPlan.map(item => item.at), [
    new Date(2026, 9, 29, 21, 35).getTime(),
    new Date(2026, 9, 29, 21, 45).getTime(),
  ]);
  assert.ok(nextPlan.every(item => !remainingPlan.some(old => old.id === item.id)));
  assert.equal(ensureDailyDoses(rolled, tomorrow), rolled);
});

test('saving a medication schedule preserves notification opt-out', () => {
  const changed = setMedicationSchedule(createInitialState(morning), {
    frequency: 'once', times: ['09:00'],
  }, morning);
  assert.equal(changed.reminders.medication, false);
  assert.deepEqual(plannedReminders(changed, morning.getTime()), []);
});
