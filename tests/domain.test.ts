import assert from 'node:assert/strict';
import test from 'node:test';
import { photoFor } from './fixtures.ts';
import {
  addDays, addVisit, createInitialState, ensureDailyDoses, localDateKey,
  hospitalNames, recordDose, removeVisit, selectHospital, setHospitalContact, setSharing, upcomingVisits,
  validateLoadedState, visibleDoses,
} from '../src/domain.ts';

const now = new Date(2026, 9, 28, 9, 0, 0);
const visit = { hospitalName: '가족의원', date: '2026-11-01', time: '12:13' };
const oldBooking = {
  id: 'example-appointment', doctorId: 'doctor-kim', date: '2026-11-01', time: '10:30',
  status: 'confirmed' as const, reason: '정기 진료 · 예시 예약', createdAt: now.toISOString(),
};

test('initial state has three pending doses and sharing and reminders are opt-in', () => {
  const state = createInitialState(now);
  assert.deepEqual(state.doses.map((dose) => dose.time), ['08:00', '13:00', '19:00']);
  assert.ok(state.doses.every((dose) => dose.date === '2026-10-28' && dose.status === 'pending'));
  assert.deepEqual(state.sharing, { caregiver: false, hospital: false });
  assert.deepEqual(state.reminders, { appointment: false, medication: false, appointmentMinutesBefore: [1440, 60], medicationMinutesBefore: [0] });
  assert.deepEqual(state.appointments, []);
  assert.deepEqual(state.visits, []);
  assert.equal(validateLoadedState(state), state);
});

test('local date helpers handle month/year boundaries and reject invalid dates', () => {
  assert.equal(localDateKey(new Date(2026, 9, 28, 0, 1)), '2026-10-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.throws(() => addDays('2026-02-30', 1));
  assert.throws(() => addDays('2026-01-01', 0.5));
});

test('patients can enter an actual visit at any future minute, including a Sunday lunch', () => {
  const state = createInitialState(now);
  const saved = addVisit(state, { ...visit, hospitalName: ' 가족의원 ' }, now);
  assert.equal(saved.visits[0].hospitalName, visit.hospitalName);
  assert.equal(saved.visits[0].time, '12:13');
  assert.deepEqual(state.visits, []);
  assert.equal(validateLoadedState(saved), saved);
  assert.throws(() => addVisit(saved, visit, now));
  assert.throws(() => addVisit(state, { ...visit, time: '24:15' }, now));
  assert.throws(() => addVisit(state, { ...visit, date: '2026-10-28', time: '09:00' }, now));
  assert.throws(() => addVisit(state, { ...visit, hospitalName: ' ' }, now));
  assert.throws(() => addVisit(state, { ...visit, date: '2026-11-31' }, now));
});

test('next visits skip elapsed and removed entries, without mutating the stored order', () => {
  const later = addVisit(createInitialState(now), visit, now);
  const state = addVisit(later, { ...visit, date: '2026-10-28', time: '15:03' }, now);
  assert.deepEqual(upcomingVisits(state, now).map(entry => entry.time), ['15:03', '12:13']);
  assert.equal(state.visits[0].id, later.visits[0].id);
  assert.deepEqual(upcomingVisits(state, new Date(2026, 9, 28, 15, 3)), later.visits);
  const removed = removeVisit(state, state.visits[1].id);
  assert.deepEqual(removed.visits, later.visits);
  assert.equal(removeVisit(removed, state.visits[1].id), removed);
});

test('only actual visit changes advance the durable revision, even if the device clock moves backwards', () => {
  const initial = createInitialState(now);
  assert.equal(initial.visitsRevision, 0);
  const saved = addVisit(initial, visit, now);
  assert.equal(saved.visitsRevision, now.getTime());
  const afterDose = recordDose(saved, saved.doses[0].id, true, now, photoFor(now));
  assert.equal(afterDose.visitsRevision, saved.visitsRevision);
  const earlier = new Date(now.getTime() - 60_000);
  const deleted = removeVisit(afterDose, saved.visits[0].id, earlier);
  assert.equal(deleted.visitsRevision, saved.visitsRevision + 1);
  assert.equal(removeVisit(deleted, saved.visits[0].id, now), deleted);
  assert.equal(validateLoadedState(deleted).visitsRevision, deleted.visitsRevision);
  assert.throws(() => validateLoadedState({ ...saved, visitsRevision: -1 }));
  assert.throws(() => validateLoadedState({ ...saved, visitsRevision: Number.MAX_SAFE_INTEGER + 1 }));
});

test('saved hospital shortcuts normalize dialable numbers and accept only HTTPS booking links', () => {
  const state = createInitialState(now);
  const contact = { name: ' 가족의원 ', phone: '02-1234-5678', bookingUrl: 'https://booking.example.org/clinic?branch=1' };
  const saved = setHospitalContact(state, contact);
  assert.deepEqual(saved.hospitalContact, { name: '가족의원', phone: '0212345678', bookingUrl: contact.bookingUrl });
  assert.equal(validateLoadedState(saved), saved);
  assert.throws(() => setHospitalContact(state, { ...contact, phone: '02;12345678' }));
  for (const bookingUrl of ['http://example.org', 'javascript:alert(1)', 'https://clinic:secret@example.org']) {
    assert.throws(() => setHospitalContact(state, { ...contact, bookingUrl }));
    assert.throws(() => validateLoadedState({ ...state, hospitalContact: { ...contact, bookingUrl } }));
  }
  assert.deepEqual(setHospitalContact(saved, { name: '', phone: '', bookingUrl: '' }).hospitalContact, state.hospitalContact);
});

test('selecting a hospital retains legacy contact details and the hospital on each saved visit', () => {
  const state = addVisit(createInitialState(now), visit, now);
  const oldContact = { name: '기존병원', phone: '0211112222', bookingUrl: 'https://example.org/booking' };
  const legacy: Record<string, unknown> = { ...state, hospitalContact: oldContact };
  delete legacy.hospitalContactsRevision;
  delete legacy.otherHospitalContacts;
  const loaded = validateLoadedState(legacy);
  assert.deepEqual(hospitalNames(loaded), ['기존병원', visit.hospitalName]);
  const next = selectHospital(loaded, ' 신규의원 ', '', now);
  assert.deepEqual(next.hospitalContact, { name: '신규의원', phone: '', bookingUrl: '' });
  assert.deepEqual(next.otherHospitalContacts, [oldContact]);
  assert.equal(next.visits, loaded.visits);
  assert.equal(next.visitsRevision, loaded.visitsRevision);
  assert.equal(next.hospitalContactsRevision, now.getTime());
  const back = selectHospital(validateLoadedState(JSON.parse(JSON.stringify(next))), oldContact.name, '', now);
  assert.deepEqual(back.hospitalContact, oldContact);
  assert.deepEqual(back.otherHospitalContacts, [next.hospitalContact]);
  assert.equal(back.hospitalContactsRevision, next.hospitalContactsRevision + 1);
  assert.deepEqual(back.visits, loaded.visits);
  assert.equal(selectHospital(back, oldContact.name), back);
  assert.deepEqual(hospitalNames(selectHospital(back, visit.hospitalName)), [visit.hospitalName, oldContact.name, '신규의원']);
  assert.throws(() => setHospitalContact(back, { ...oldContact, name: '신규의원' }));
  assert.throws(() => validateLoadedState({ ...back, otherHospitalContacts: [oldContact] }));
  assert.throws(() => validateLoadedState({ ...back, otherHospitalContacts: [{ ...oldContact, name: '다른병원', bookingUrl: 'http://example.org' }] }));
});

test('dose recording is idempotent and undo retains an audit trail', () => {
  const state = createInitialState(now);
  const doseId = state.doses[0].id;
  const recorded = recordDose(state, doseId, true, now, photoFor(now));
  assert.equal(recorded.doses[0].status, 'taken');
  assert.equal(recorded.doses[0].takenAt, now.toISOString());
  assert.equal(state.doses[0].status, 'pending');
  assert.equal(recordDose(recorded, doseId, true, now), recorded);
  const undone = recordDose(recorded, doseId, false, now);
  assert.equal(undone.doses[0].status, 'pending');
  assert.equal(undone.doses[0].takenAt, undefined);
  assert.equal(undone.activity.length, 2);
  assert.match(undone.activity[0].text, /기록을 취소/);
  assert.match(undone.activity[1].text, /환자 자가 기록/);
  assert.equal(validateLoadedState(undone), undone);
});

test('future-day dose reports are blocked, while same-day self-reports are allowed', () => {
  const state = createInitialState(now);
  assert.equal(recordDose(state, state.doses[2].id, true, now, photoFor(now)).doses[2].status, 'taken');
  const tomorrow = ensureDailyDoses(state, new Date(2026, 9, 29, 0, 1));
  assert.throws(() => recordDose(tomorrow, tomorrow.doses[3].id, true, now, photoFor(now)));
});

test('daily rollover keeps history and adds each schedule only once', () => {
  const initial = createInitialState(now);
  const recorded = recordDose(initial, initial.doses[0].id, true, now, photoFor(now));
  const tomorrow = new Date(2026, 9, 29, 0, 1);
  const rolled = ensureDailyDoses(recorded, tomorrow);
  assert.equal(rolled.doses.length, 6);
  assert.equal(rolled.doses[0].status, 'taken');
  assert.ok(rolled.doses.slice(3).every((dose) => dose.status === 'pending' && dose.date === '2026-10-29'));
  assert.equal(ensureDailyDoses(rolled, tomorrow), rolled);
});

test('each sharing consent is independent and revocation immediately hides records', () => {
  const state = createInitialState(now);
  assert.equal(visibleDoses(state, 'patient').length, 3);
  assert.deepEqual(visibleDoses(state, 'caregiver'), []);
  assert.deepEqual(visibleDoses(state, 'hospital'), []);
  const shared = setSharing(state, 'caregiver', true, now);
  assert.equal(visibleDoses(shared, 'caregiver').length, 3);
  assert.deepEqual(visibleDoses(shared, 'hospital'), []);
  const revoked = setSharing(shared, 'caregiver', false, now);
  assert.deepEqual(visibleDoses(revoked, 'caregiver'), []);
  assert.equal(visibleDoses(revoked, 'patient').length, 3);
  assert.equal(revoked.activity.length, 2);
});

test('storage validation rejects malformed, contradictory and duplicate records', () => {
  const state = createInitialState(now);
  assert.throws(() => validateLoadedState(null));
  assert.throws(() => validateLoadedState({ ...state, version: 2 }));
  assert.throws(() => validateLoadedState({ ...state, sharing: { caregiver: 'yes', hospital: false } }));
  assert.throws(() => validateLoadedState({ ...state, doses: [{ ...state.doses[0], status: 'taken' }] }));
  assert.throws(() => validateLoadedState({ ...state, doses: [{ ...state.doses[0], date: '2026-02-30' }] }));
  assert.throws(() => validateLoadedState({ ...state, doses: [...state.doses, { ...state.doses[0], id: 'duplicate-time' }] }));
  assert.throws(() => validateLoadedState({ ...state, appointments: [oldBooking, oldBooking] }));
  assert.throws(() => validateLoadedState({ ...state, appointments: [{ ...oldBooking, doctorId: 'unknown' }] }));
  assert.throws(() => validateLoadedState({ ...state, visits: [{ ...visit, id: 'abc', date: '2026-02-30' }] }));
});

test('legacy simulated bookings are preserved separately and never promoted into patient visits', () => {
  const legacy: Record<string, unknown> = { ...createInitialState(now), appointments: [oldBooking] };
  delete legacy.visits;
  delete legacy.visitsRevision;
  delete legacy.hospitalContact;
  const restored = validateLoadedState(legacy);
  assert.deepEqual(restored.appointments, [oldBooking]);
  assert.deepEqual(upcomingVisits(restored, now), []);
  assert.equal(restored.visitsRevision, 0);
  assert.deepEqual(restored.hospitalContact, { name: '', phone: '', bookingUrl: '' });
  assert.equal(validateLoadedState(restored), restored);
});
