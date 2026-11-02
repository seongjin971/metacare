import assert from 'node:assert/strict';
import test from 'node:test';
import { photoFor } from './fixtures.ts';
import { addVisit, createInitialState, ensureDailyDoses, recordDose, removeVisit, setReminderOffsets, validateLoadedState } from '../src/domain.ts';
import { MAX_SCHEDULED_REMINDERS, plannedReminders } from '../src/reminder-plan.ts';
import { formatReminderOffset, normalizeReminderOffsets } from '../src/reminder-settings.ts';

const now = new Date(2026, 9, 28, 6);
const visit = { hospitalName: '동네의원', date: '2026-10-29', time: '10:30' };

test('existing reminder settings migrate without losing records or changing opt-in', () => {
  const initial = createInitialState(now);
  const legacy = { ...initial, reminders: { appointment: true, medication: false } };
  const before = JSON.stringify(legacy);
  const upgraded = validateLoadedState(legacy);
  assert.deepEqual(upgraded.reminders, {
    appointment: true, medication: false,
    appointmentMinutesBefore: [1440, 60], medicationMinutesBefore: [0],
  });
  assert.equal(upgraded.appointments, initial.appointments);
  assert.equal(upgraded.doses, initial.doses);
  assert.equal(upgraded.sharing, initial.sharing);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(validateLoadedState(upgraded), upgraded);
});

test('offsets accept custom minutes, deduplicate and reject invalid selections', () => {
  assert.deepEqual(normalizeReminderOffsets('appointment', [0, 60, 7, 60, 43200]), [43200, 60, 7, 0]);
  assert.deepEqual(normalizeReminderOffsets('medication', [5, 1440, 0]), [1440, 5, 0]);
  for (const values of [[], null, [NaN], [Infinity], ['5'], [-1], [0.5], [1441], Array.from({ length: 9 }, (_, i) => i)]) {
    assert.throws(() => normalizeReminderOffsets('medication', values));
  }
  assert.throws(() => normalizeReminderOffsets('appointment', [43201]));
  const state = createInitialState(now);
  for (const values of [null, [], [-1], ['15'], [0.5], [Infinity]]) {
    assert.throws(() => validateLoadedState({ ...state, reminders: { ...state.reminders, medicationMinutesBefore: values } }));
  }
  const normalized = validateLoadedState({ ...state, reminders: { ...state.reminders, appointmentMinutesBefore: [15, 60, 15] } });
  assert.deepEqual(normalized.reminders.appointmentMinutesBefore, [60, 15]);
  const changed = setReminderOffsets(state, 'medication', [0, 17]);
  assert.deepEqual(changed.reminders.medicationMinutesBefore, [17, 0]);
  assert.equal(changed.reminders.medication, false);
  assert.deepEqual(state.reminders.medicationMinutesBefore, [0]);
  assert.equal(setReminderOffsets(changed, 'medication', [0, 17, 17]), changed);
  assert.equal(formatReminderOffset(0), '정시');
  assert.equal(formatReminderOffset(7), '7분 전');
  assert.equal(formatReminderOffset(90), '1시간 30분 전');
  assert.equal(formatReminderOffset(1505), '1일 1시간 5분 전');
});

test('appointment plans use every selected offset across day and month boundaries', () => {
  let state = addVisit(createInitialState(now), { ...visit, date: '2026-11-02', time: '00:10' }, now);
  state = setReminderOffsets(state, 'appointment', [0, 15, 60, 1440]);
  state = {
    ...state,
    reminders: { ...state.reminders, appointment: true },
    // An old simulated confirmed booking must not produce an alarm.
    appointments: [{ id: 'example-appointment', doctorId: 'doctor-kim', date: '2026-11-03', time: '08:00', status: 'confirmed', reason: '', createdAt: now.toISOString() }],
  };
  const before = JSON.stringify(state);
  const plan = plannedReminders(state, new Date(2026, 9, 31, 23).getTime());
  assert.deepEqual(plan.map(item => item.at), [
    new Date(2026, 10, 1, 0, 10).getTime(),
    new Date(2026, 10, 1, 23, 10).getTime(),
    new Date(2026, 10, 1, 23, 55).getTime(),
    new Date(2026, 10, 2, 0, 10).getTime(),
  ]);
  assert.ok(plan.every(item => item.url === '/appointments' && item.id.endsWith(String(item.at))));
  assert.equal(new Set(plan.map(item => item.id)).size, 4);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(plannedReminders(state, new Date(2026, 10, 1, 23, 55).getTime()).map(item => item.at), [new Date(2026, 10, 2, 0, 10).getTime()]);
});

test('medication plans apply minute offsets only to today’s pending future alarms', () => {
  let state = setReminderOffsets(createInitialState(now), 'medication', [0, 5, 17]);
  state = { ...state, reminders: { ...state.reminders, medication: true } };
  state = ensureDailyDoses(state, new Date(2026, 9, 29));
  const plan = plannedReminders(state, new Date(2026, 9, 28, 7, 50).getTime());
  const morning = plan.filter(item => item.entityId === state.doses[0].id);
  assert.deepEqual(morning.map(item => item.at), [new Date(2026, 9, 28, 7, 55).getTime(), new Date(2026, 9, 28, 8).getTime()]);
  assert.equal(plan.length, 8);
  assert.ok(plan.every(item => item.url === '/'));
  assert.ok(plan.every(item => state.doses.slice(0, 3).some(dose => dose.id === item.entityId)));
});

test('taking a dose, removing a visit and changing offsets remove stale planned IDs', () => {
  let state = addVisit(createInitialState(now), visit, now);
  state = { ...state, reminders: { ...state.reminders, appointment: true, medication: true } };
  const old = plannedReminders(state, now.getTime());
  assert.ok(old.some(item => item.entityId === state.doses[0].id));
  const taken = recordDose(state, state.doses[0].id, true, now, photoFor(now));
  assert.ok(plannedReminders(taken, now.getTime()).every(item => item.entityId !== state.doses[0].id));
  const removed = removeVisit(taken, state.visits[0].id);
  assert.ok(plannedReminders(removed, now.getTime()).every(item => item.entityId !== state.visits[0].id));
  const changed = setReminderOffsets(state, 'appointment', [30]);
  const newAppointment = plannedReminders(changed, now.getTime()).filter(item => item.url === '/appointments');
  assert.equal(newAppointment.length, 1);
  assert.ok(newAppointment.every(item => !old.some(previous => previous.id === item.id)));
  const disabled = { ...changed, reminders: { ...changed.reminders, appointment: false, medication: false } };
  assert.deepEqual(plannedReminders(disabled, now.getTime()), []);
});

test('the native reminder queue keeps the earliest alarms within its existing budget', () => {
  let state = setReminderOffsets(createInitialState(now), 'appointment', [0, 5, 10, 15, 30, 60, 120, 180]);
  state = {
    ...state, reminders: { ...state.reminders, appointment: true },
    visits: Array.from({ length: 10 }, (_, index) => ({ ...visit, id: `visit-${index}`, date: `2026-11-${String(index + 2).padStart(2, '0')}` })),
  };
  const plan = plannedReminders(state, now.getTime());
  assert.equal(plan.length, MAX_SCHEDULED_REMINDERS);
  assert.equal(new Set(plan.map(item => item.id)).size, MAX_SCHEDULED_REMINDERS);
  assert.ok(plan.every((item, index) => !index || plan[index - 1].at <= item.at));
  assert.ok(plan.every(item => Number(item.entityId.slice(-1)) < 6));
});
