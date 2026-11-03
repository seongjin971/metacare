import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, localDateKey, validateLoadedState, type Dose } from '../src/domain.ts';
import { makeCareSnapshot } from '../src/caregiver-snapshot.ts';

const now = new Date(2026, 10, 1, 12);
function dose(id: string, daysAgo = 0): Dose {
  return {
    id, date: localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo)),
    time: '08:00', label: '아침 약', description: '공유하지 않는 처방 설명', status: 'pending',
  };
}

test('sharing whitelists medication fields without mutating the patient store', () => {
  const state = validateLoadedState({
    ...createInitialState(now),
    consultations: [{ id: 'private-chat', subject: '상담 제목', message: '상담 비밀', createdAt: now.toISOString(), status: 'waiting' }],
  });
  state.doses = [{
    ...dose('taken'), status: 'taken', takenAt: now.toISOString(),
    photo: {
      id: 'photo-verified', capturedAt: now.toISOString(), width: 1200, height: 900,
      verification: { method: 'medicine-pouch-text-v1', checkedAt: now.toISOString() },
    },
  }, dose('pending')];
  state.appointments = [{ id: 'private-appointment', doctorId: 'doctor-kim', date: '2026-11-02', time: '09:00', status: 'confirmed', reason: '진료 이유', createdAt: now.toISOString() }];
  const before = JSON.stringify(state);
  const snapshot = makeCareSnapshot(state, '홍길동', now);
  assert.deepEqual(Object.keys(snapshot).sort(), ['doses', 'patientName', 'schedule', 'timeZone']);
  assert.equal(snapshot.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.deepEqual(Object.keys(snapshot.doses[0]).sort(), ['date', 'id', 'label', 'photo', 'status', 'takenAt', 'time']);
  assert.deepEqual(snapshot.doses[0].photo, { id: 'photo-verified', capturedAt: now.toISOString(), verified: true });
  assert.equal(snapshot.doses[1].takenAt, undefined);
  assert.equal(snapshot.doses[1].photo, undefined);
  assert.equal(/상담 비밀|진료 이유|처방 설명|checkedAt|width|height/.test(JSON.stringify(snapshot)), false);
  assert.equal(JSON.stringify(state), before);
  snapshot.schedule.times.push('22:00');
  assert.equal(JSON.stringify(state), before);
});

test('sharing includes exactly the latest 90 local calendar days and never future doses', () => {
  const state = createInitialState(now);
  state.doses = [dose('future', -1), dose('today'), dose('oldest-included', 89), dose('excluded', 90)];
  assert.deepEqual(makeCareSnapshot(state, '환자', now).doses.map(item => item.id), ['today', 'oldest-included']);
});

test('only separate consent shares the closest upcoming manual visit, without its ID or hospital contact', () => {
  const state = createInitialState(now);
  state.hospitalContact = { name: '시연 의원', phone: '0212345678', bookingUrl: 'https://hospital.example/booking' };
  state.visits = [
    { id: 'later', hospitalName: '다음 달 병원', date: '2026-12-01', time: '10:00' },
    { id: 'ended', hospitalName: '지난 병원', date: '2026-11-01', time: '12:00' },
    { id: 'private-visit-id', hospitalName: '시연 의원', date: '2026-11-01', time: '12:03' },
  ];
  state.appointments = [{ id: 'legacy', doctorId: 'doctor-kim', date: '2026-11-01', time: '12:01', status: 'confirmed', reason: '체험 예약', createdAt: now.toISOString() }];
  assert.ok(!Object.hasOwn(makeCareSnapshot(state, '환자', now), 'nextVisit'));
  const consented = makeCareSnapshot(state, '환자', now, true);
  assert.deepEqual(consented.nextVisit, {
    hospitalName: '시연 의원', date: '2026-11-01', time: '12:03',
  });
  assert.doesNotMatch(JSON.stringify(consented), /hospital\.example|0212345678|private-visit-id|다음 달 병원/);
  assert.ok(!Object.hasOwn(makeCareSnapshot(state, '환자', now, false), 'nextVisit'));
  state.visits = [];
  assert.ok(!Object.hasOwn(makeCareSnapshot(state, '환자', now, true), 'nextVisit'));
});

test('sharing keeps only the newest 300 records', () => {
  const state = createInitialState(now);
  state.doses = Array.from({ length: 400 }, (_, index) => ({
    ...dose(`dose-${index}`, Math.floor(index / 5)), time: `${String(8 + index % 5).padStart(2, '0')}:00`,
  }));
  const snapshot = makeCareSnapshot(state, '환자', now);
  assert.equal(snapshot.doses.length, 300);
  assert.equal(snapshot.doses[0].id, 'dose-4');
  assert.equal(snapshot.doses[299].id, 'dose-295');
  assert.equal(snapshot.doses.some(item => Number(item.id.split('-')[1]) >= 300), false);
});

test('only the 30 most recently captured photos are referenced and legacy photos are unverified', () => {
  const state = createInitialState(now);
  state.doses = Array.from({ length: 35 }, (_, index) => ({
    ...dose(`dose-${index}`, index), status: 'taken', takenAt: now.toISOString(),
    photo: { id: `photo-${index}`, capturedAt: new Date(now.getTime() + index * 1000).toISOString(), width: 500, height: 500 },
  }));
  const snapshot = makeCareSnapshot(state, '환자', now);
  const photos = snapshot.doses.flatMap(item => item.photo ? [item.photo] : []);
  assert.equal(snapshot.doses.length, 35);
  assert.equal(photos.length, 30);
  assert.equal(photos.every(photo => Number(photo.id.split('-')[1]) >= 5), true);
  assert.equal(photos.every(photo => photo.verified === false), true);
});

test('pending records never expose a stale photo reference', () => {
  const state = createInitialState(now);
  state.doses = [{ ...dose('pending'), photo: { id: 'photo-old', capturedAt: now.toISOString(), width: 500, height: 500 } }];
  assert.equal(makeCareSnapshot(state, '환자', now).doses[0].photo, undefined);
});
