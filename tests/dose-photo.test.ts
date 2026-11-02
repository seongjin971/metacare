import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, ensureDailyDoses, recordDose, validateLoadedState } from '../src/domain.ts';
import { isDosePhoto, normalizeDosePhoto, type DosePhoto } from '../src/dose-photo.ts';
import { photoFor } from './fixtures.ts';

const now = new Date(2026, 9, 28, 8, 5);

test('new dose completion requires photo metadata and failed attempts leave the day unchanged', () => {
  const state = createInitialState(now);
  const before = JSON.stringify(state);
  assert.throws(() => recordDose(state, state.doses[0].id, true, now), /사진을 촬영/);
  for (const photo of [null, {}, { ...photoFor(now), id: '' }, { ...photoFor(now), width: 0 }]) {
    assert.throws(() => recordDose(state, state.doses[0].id, true, now, photo as DosePhoto));
  }
  assert.equal(JSON.stringify(state), before);
  assert.equal(recordDose(state, state.doses[0].id, false, now), state);
});

test('photo metadata rejects unsafe IDs, invalid timestamps and invalid image sizes', () => {
  const valid = photoFor(now);
  assert.equal(isDosePhoto(valid), true);
  const copy = normalizeDosePhoto({ ...valid, uri: 'file:///not-persisted.jpg' });
  assert.deepEqual(copy, valid);
  assert.notEqual(copy, valid);
  for (const invalid of [
    null, [], '',
    { ...valid, id: '../private' }, { ...valid, id: 'photo-../private' },
    { ...valid, id: 'photo-file:///secret' }, { ...valid, id: `photo-${'a'.repeat(121)}` },
    { ...valid, capturedAt: '2026-02-30T00:00:00.000Z' }, { ...valid, capturedAt: 'yesterday' },
    { ...valid, capturedAt: null }, { ...valid, width: Infinity },
    { ...valid, width: 1.5 }, { ...valid, height: -1 }, { ...valid, height: 20001 },
  ]) {
    assert.equal(isDosePhoto(invalid), false);
    assert.throws(() => normalizeDosePhoto(invalid));
  }
});

test('photo and capture time persist with the record without sharing mutable input', () => {
  const state = createInitialState(now);
  const captureTime = new Date(now.getTime() - 1000);
  const photo = photoFor(captureTime);
  const recorded = recordDose(state, state.doses[0].id, true, now, photo);
  assert.equal(recorded.doses[0].status, 'taken');
  assert.equal(recorded.doses[0].takenAt, now.toISOString());
  assert.deepEqual(recorded.doses[0].photo, photo);
  assert.notEqual(recorded.doses[0].photo, photo);
  photo.width = 100;
  assert.equal(recorded.doses[0].photo?.width, 640);
  const restored = ensureDailyDoses(validateLoadedState(JSON.parse(JSON.stringify(recorded))), new Date(2026, 9, 29));
  assert.deepEqual(restored.doses[0], recorded.doses[0]);
  assert.equal(recordDose(recorded, state.doses[0].id, true, now), recorded);
  assert.match(recorded.activity[0].text, /사진과 함께/);
  assert.match(recorded.activity[0].text, /환자 자가 기록/);
});

test('one capture cannot complete multiple doses and cannot be captured after completion', () => {
  const state = createInitialState(now);
  const photo = photoFor(now);
  const recorded = recordDose(state, state.doses[0].id, true, now, photo);
  assert.throws(() => recordDose(recorded, state.doses[1].id, true, now, photo), /이미 기록/);
  assert.throws(() => recordDose(state, state.doses[0].id, true, now, photoFor(new Date(now.getTime() + 1))), /촬영 시간/);
  const duplicated = {
    ...recorded,
    doses: recorded.doses.map((dose, index) => index === 1 ? { ...dose, status: 'taken', takenAt: now.toISOString(), photo } : dose),
  };
  assert.throws(() => validateLoadedState(duplicated));
  const outOfOrder = {
    ...recorded,
    doses: recorded.doses.map((dose, index) => index === 0 ? { ...dose, takenAt: new Date(now.getTime() - 1).toISOString() } : dose),
  };
  assert.throws(() => validateLoadedState(outOfOrder));
});

test('undo removes photo and completion time; another completion still requires a photo', () => {
  const initial = createInitialState(now);
  const recorded = recordDose(initial, initial.doses[0].id, true, now, photoFor(now));
  const undone = recordDose(recorded, recorded.doses[0].id, false, now);
  assert.equal(undone.doses[0].status, 'pending');
  assert.equal(undone.doses[0].photo, undefined);
  assert.equal(undone.doses[0].takenAt, undefined);
  assert.ok(recorded.doses[0].photo);
  assert.equal(validateLoadedState(undone), undone);
  assert.throws(() => recordDose(undone, undone.doses[0].id, true, now));
  const retaken = recordDose(undone, undone.doses[0].id, true, now, photoFor(now));
  assert.notEqual(retaken.doses[0].photo?.id, recorded.doses[0].photo?.id);
  assert.throws(() => validateLoadedState({ ...initial, doses: [{ ...initial.doses[0], photo: photoFor(now) }] }));
});

test('old records without photos survive migration unchanged but new records cannot omit photos', () => {
  const state = createInitialState(now);
  const legacy = {
    ...state,
    doses: state.doses.map((dose, index) => index === 0 ? { ...dose, status: 'taken', takenAt: now.toISOString() } : dose),
  };
  const serialized = JSON.stringify(legacy);
  const loaded = validateLoadedState(JSON.parse(serialized));
  assert.equal(JSON.stringify(loaded), serialized);
  assert.equal(loaded.doses[0].photo, undefined);
  assert.equal(recordDose(loaded, loaded.doses[0].id, true, now), loaded);
  assert.throws(() => recordDose(loaded, loaded.doses[1].id, true, now), /사진을 촬영/);
});

test('old unverified photos survive loading but cannot authorize a new completion', () => {
  const state = createInitialState(now);
  const { verification: _verification, ...legacyPhoto } = photoFor(now);
  const legacy = { ...state, doses: state.doses.map((dose, index) => index === 0
    ? { ...dose, status: 'taken', takenAt: now.toISOString(), photo: legacyPhoto } : dose) };
  assert.equal(validateLoadedState(legacy), legacy);
  assert.throws(() => recordDose(state, state.doses[1].id, true, now, legacyPhoto), /사진 확인/);
  assert.equal(state.doses[1].status, 'pending');
});

test('verification metadata must be valid and precede the durable record', () => {
  const state = createInitialState(now);
  const photo = photoFor(now);
  for (const verification of [null, {}, { method: 'bypass', checkedAt: now.toISOString() },
    { method: 'medicine-pouch-text-v1', checkedAt: new Date(now.getTime() - 1).toISOString() }]) {
    assert.equal(isDosePhoto({ ...photo, verification }), false);
  }
  const future = { ...photo, verification: { ...photo.verification!, checkedAt: new Date(now.getTime() + 1000).toISOString() } };
  assert.throws(() => recordDose(state, state.doses[0].id, true, now, future), /사진 확인 시간/);
  const recorded = recordDose(state, state.doses[0].id, true, now, photo);
  photo.verification!.checkedAt = new Date(now.getTime() + 1000).toISOString();
  assert.equal(recorded.doses[0].photo?.verification?.checkedAt, now.toISOString());
  assert.throws(() => validateLoadedState({ ...recorded, doses: recorded.doses.map((dose, index) => index === 0 ? { ...dose, photo: future } : dose) }));
});
