import assert from 'node:assert/strict';
import test from 'node:test';
import { photoFor } from './fixtures.ts';
import {
  createInitialState, ensureDailyDoses, recordDose, setMedicationSchedule, validateLoadedState,
} from '../src/domain.ts';
import {
  defaultMedicationSchedule, MEDICATION_FREQUENCIES, medicationScheduleLabel, normalizeMedicationSchedule,
} from '../src/medication-schedule.ts';

const morning = new Date(2026, 9, 28, 7);
const tomorrow = new Date(2026, 9, 29, 7);

test('frequency presets produce the selected count and distinct meal labels with independent defaults', () => {
  const original = createInitialState(morning);
  const once = setMedicationSchedule(original, defaultMedicationSchedule('once'), morning);
  const twice = setMedicationSchedule(once, defaultMedicationSchedule('twice'), morning);
  const three = setMedicationSchedule(twice, defaultMedicationSchedule('three'), morning);
  assert.deepEqual(once.doses.map(dose => [dose.label, dose.time]), [['복용약', '08:00']]);
  assert.deepEqual(twice.doses.map(dose => [dose.label, dose.time]), [['아침 복용약', '08:00'], ['저녁 복용약', '19:00']]);
  assert.deepEqual(three.doses.map(dose => dose.label), ['아침 복용약', '점심 복용약', '저녁 복용약']);
  assert.equal(original.doses.length, 3);
  const mutable = defaultMedicationSchedule('once');
  mutable.times[0] = '22:00';
  assert.deepEqual(defaultMedicationSchedule('once').times, ['08:00']);
  assert.equal(MEDICATION_FREQUENCIES.length, 3);
  assert.equal(medicationScheduleLabel(twice.medicationSchedule), '아침·저녁');
});

test('custom times validate whole-day boundaries, frequency counts, uniqueness and meal order', () => {
  const input = { frequency: 'twice', times: ['00:00', '23:59'] };
  const normalized = normalizeMedicationSchedule(input);
  assert.deepEqual(normalized, input);
  assert.notEqual(normalized.times, input.times);
  for (const malformed of [
    null, [], {}, { frequency: 'weekly', times: ['08:00'] },
    { frequency: 'once', times: [] }, { frequency: 'once', times: ['08:00', '19:00'] },
    { frequency: 'once', times: ['8:00'] }, { frequency: 'once', times: ['24:00'] },
    { frequency: 'once', times: ['08:60'] }, { frequency: 'once', times: [800] },
    { frequency: 'twice', times: ['19:00', '08:00'] },
    { frequency: 'twice', times: ['08:00', '08:00'] },
  ]) assert.throws(() => normalizeMedicationSchedule(malformed));
});

test('editing an unrecorded day replaces only that day, leaves history intact and is idempotent', () => {
  let state = createInitialState(new Date(2026, 9, 27, 7));
  state = recordDose(state, state.doses[0].id, true, new Date(2026, 9, 27, 8, 5), photoFor(new Date(2026, 9, 27, 8, 5)));
  state = ensureDailyDoses(state, morning);
  const before = JSON.stringify(state);
  const previousDay = state.doses.filter(dose => dose.date === '2026-10-27');
  const changed = setMedicationSchedule(state, { frequency: 'once', times: ['21:35'] }, morning);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(changed.doses.filter(dose => dose.date === '2026-10-27'), previousDay);
  assert.deepEqual(changed.doses.filter(dose => dose.date === '2026-10-28').map(dose => [dose.time, dose.status]), [['21:35', 'pending']]);
  assert.equal(ensureDailyDoses(changed, morning), changed);
  assert.equal(setMedicationSchedule(changed, changed.medicationSchedule, morning), changed);
  const rolled = ensureDailyDoses(changed, tomorrow);
  assert.deepEqual(rolled.doses.filter(dose => dose.date === '2026-10-29').map(dose => dose.time), ['21:35']);
  assert.equal(ensureDailyDoses(rolled, tomorrow), rolled);
});

test('a recorded day remains a complete snapshot while changed settings apply to the next day', () => {
  let state = createInitialState(morning);
  const recordedAt = new Date(2026, 9, 28, 8, 12);
  state = recordDose(state, state.doses[0].id, true, recordedAt, photoFor(recordedAt));
  const changed = setMedicationSchedule(state, { frequency: 'twice', times: ['09:10', '20:45'] }, recordedAt);
  assert.equal(changed.doses, state.doses);
  assert.equal(changed.doses[0].takenAt, recordedAt.toISOString());
  assert.equal(changed.doses.filter(dose => dose.status === 'pending').length, 2);
  assert.equal(ensureDailyDoses(changed, recordedAt), changed);
  const restored = validateLoadedState(JSON.parse(JSON.stringify(changed)));
  const rolled = ensureDailyDoses(restored, tomorrow);
  assert.deepEqual(rolled.doses.filter(dose => dose.date === '2026-10-28'), state.doses);
  assert.deepEqual(rolled.doses.filter(dose => dose.date === '2026-10-29').map(dose => dose.time), ['09:10', '20:45']);
  assert.match(changed.activity[0].text, /내일부터 적용/);
});

test('legacy storage gains the prior three-dose default without changing any existing data', () => {
  let state = createInitialState(morning);
  state = recordDose(state, state.doses[1].id, true, new Date(2026, 9, 28, 13, 15), photoFor(new Date(2026, 9, 28, 13, 15)));
  const legacy = JSON.parse(JSON.stringify(state));
  delete legacy.medicationSchedule;
  const original = JSON.stringify(legacy);
  const migrated = validateLoadedState(legacy);
  assert.deepEqual(migrated.medicationSchedule, defaultMedicationSchedule());
  assert.deepEqual(migrated.doses, state.doses);
  assert.deepEqual(migrated.appointments, state.appointments);
  assert.deepEqual(migrated.sharing, state.sharing);
  assert.deepEqual(migrated.activity, state.activity);
  assert.equal(JSON.stringify(legacy), original);
  assert.equal(ensureDailyDoses(migrated, morning), migrated);
  assert.equal(validateLoadedState(migrated), migrated);
});

test('saved settings round-trip exactly and corrupted provided settings are rejected', () => {
  const state = setMedicationSchedule(createInitialState(morning), { frequency: 'twice', times: ['06:25', '18:40'] }, morning);
  const stored = JSON.stringify(state);
  const restored = validateLoadedState(JSON.parse(stored));
  assert.equal(JSON.stringify(restored), stored);
  assert.equal(ensureDailyDoses(restored, morning), restored);
  for (const medicationSchedule of [null, {}, { frequency: 'once', times: ['bad'] }, { frequency: 'twice', times: ['09:00'] }]) {
    assert.throws(() => validateLoadedState({ ...state, medicationSchedule }));
  }
});

test('saving a schedule after undoing the only record can update the now-unrecorded day', () => {
  let state = createInitialState(morning);
  state = recordDose(state, state.doses[0].id, true, morning, photoFor(morning));
  state = setMedicationSchedule(state, { frequency: 'once', times: ['20:00'] }, morning);
  state = recordDose(state, state.doses[0].id, false, morning);
  const changed = setMedicationSchedule(state, state.medicationSchedule, morning);
  assert.equal(changed.doses.length, 1);
  assert.equal(changed.doses[0].time, '20:00');
  assert.ok(changed.doses.every(dose => dose.takenAt === undefined));
  assert.ok(changed.activity.some(entry => /기록을 취소/.test(entry.text)));
});
