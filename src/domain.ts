import { DEFAULT_REMINDER_OFFSETS, normalizeReminderOffsets, type ReminderKind } from './reminder-settings.ts';
import { defaultMedicationSchedule, MEDICATION_FREQUENCIES, medicationScheduleLabel, normalizeMedicationSchedule, type MedicationSchedule } from './medication-schedule.ts';
import { isDosePhoto, normalizeDosePhoto, type DosePhoto } from './dose-photo.ts';
import { isCareName, isUpcomingVisit } from '../shared/care-visit.ts';

export type Role = 'patient' | 'caregiver' | 'hospital';

/** Archived on-device simulation rows from versions before visit schedules. */
type LegacyAppointment = {
  id: string;
  doctorId: string;
  date: string;
  time: string;
  status: 'confirmed' | 'cancelled';
  reason: string;
  createdAt: string;
};

export type Visit = { id: string; hospitalName: string; date: string; time: string };
export type HospitalContact = { name: string; phone: string; bookingUrl: string };
const EMPTY_CONTACT: HospitalContact = { name: '', phone: '', bookingUrl: '' };

export type Dose = {
  id: string;
  date: string;
  time: string;
  label: string;
  description: string;
  status: 'pending' | 'taken';
  takenAt?: string;
  photo?: DosePhoto;
};

export type Activity = { id: string; text: string; createdAt: string };
/**
 * Shown to the paired caregiver. Its presence also marks first-run setup as finished.
 * startedAt is set only for a brand-new patient: doses already past on that day are not expected.
 */
export type PatientProfile = { name: string; startedAt?: string };
/** A dose this many minutes past its time at setup is not expected; matches the overdue grace period. */
const START_GRACE_MINUTES = 30;
export const MAX_PATIENT_NAME = 40;

export type AppState = {
  version: 1;
  appointments: LegacyAppointment[];
  visits: Visit[];
  visitsRevision: number;
  hospitalContact: HospitalContact;
  otherHospitalContacts: HospitalContact[];
  hospitalContactsRevision: number;
  doses: Dose[];
  medicationSchedule: MedicationSchedule;
  sharing: { caregiver: boolean; hospital: boolean };
  reminders: {
    appointment: boolean;
    medication: boolean;
    appointmentMinutesBefore: number[];
    medicationMinutesBefore: number[];
  };
  activity: Activity[];
  profile?: PatientProfile;
};

const LEGACY_DOCTORS = new Set<unknown>(['doctor-kim', 'doctor-lee', 'doctor-park']);
let nextId = 0;

function id(prefix: string, now: Date): string {
  nextId += 1;
  return `${prefix}-${now.getTime()}-${nextId}-${Math.random().toString(36).slice(2, 8)}`;
}

function validNow(now: Date): void {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('날짜와 시간을 확인해 주세요.');
}

function dateParts(value: string): [number, number, number] {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('날짜 형식을 확인해 주세요.');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  if (year < 1000 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error('올바른 날짜를 선택해 주세요.');
  }
  return [year, month, day];
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function localDateTime(date: string, time: string): Date {
  const [year, month, day] = dateParts(date);
  if (!isTime(time)) throw new Error('시간 형식을 확인해 주세요.');
  const [hour, minute] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

export function localDateKey(date = new Date()): string {
  validNow(date);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function addDays(date: string, amount: number): string {
  if (!Number.isInteger(amount)) throw new Error('날짜 간격은 정수여야 해요.');
  const [year, month, day] = dateParts(date);
  return localDateKey(new Date(year, month - 1, day + amount, 12));
}

export function formatDate(date: string, options?: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = dateParts(date);
  return new Intl.DateTimeFormat('ko-KR', options ?? { month: 'long', day: 'numeric', weekday: 'short' })
    .format(new Date(year, month - 1, day, 12));
}

function withActivity(state: AppState, text: string, now: Date): AppState {
  return { ...state, activity: [{ id: id('activity', now), text, createdAt: now.toISOString() }, ...state.activity] };
}

function dosesForDate(date: string, schedule: MedicationSchedule, startedAt?: string): Dose[] {
  const option = MEDICATION_FREQUENCIES.find(item => item.value === schedule.frequency)!;
  const started = startedAt ? new Date(startedAt) : undefined;
  return schedule.times.map((time, index): Dose => ({
    id: `dose-${date}-${time.replace(':', '')}`, date, time, status: 'pending',
    label: schedule.frequency === 'once' ? '복용약' : `${option.timeLabels[index]} 복용약`,
    description: '설정한 복약 일정',
  })).filter(dose => !started || localDateKey(started) !== date
    || localDateTime(date, dose.time).getTime() + START_GRACE_MINUTES * 60000 > started.getTime());
}

/** True on the day a new patient finished setup, when doses before that moment were left out. */
export function startedOn(state: AppState, date: string): boolean {
  return !!state.profile?.startedAt && localDateKey(new Date(state.profile.startedAt)) === date;
}

export function createInitialState(now = new Date()): AppState {
  validNow(now);
  const medicationSchedule = defaultMedicationSchedule();
  return {
    version: 1,
    appointments: [],
    visits: [],
    visitsRevision: 0,
    hospitalContact: { ...EMPTY_CONTACT },
    otherHospitalContacts: [],
    hospitalContactsRevision: 0,
    doses: dosesForDate(localDateKey(now), medicationSchedule),
    medicationSchedule,
    sharing: { caregiver: false, hospital: false },
    reminders: {
      appointment: false, medication: false,
      appointmentMinutesBefore: [...DEFAULT_REMINDER_OFFSETS.appointment],
      medicationMinutesBefore: [...DEFAULT_REMINDER_OFFSETS.medication],
    },
    activity: [],
  };
}

function nextVisitRevision(previous: number, now: Date): number {
  const revision = Math.max(now.getTime(), previous + 1);
  if (!Number.isSafeInteger(revision)) throw new Error('진료 일정의 변경 순서를 확인할 수 없어요.');
  return revision;
}

export function addVisit(state: AppState, input: Omit<Visit, 'id'>, now = new Date()): AppState {
  validNow(now);
  const hospitalName = input.hospitalName.trim();
  if (!isCareName(hospitalName, 80)) throw new Error('병원 이름을 1~80자로 입력해 주세요.');
  const startsAt = localDateTime(input.date, input.time);
  if (startsAt.getHours() !== Number(input.time.slice(0, 2)) || startsAt.getMinutes() !== Number(input.time.slice(3))) {
    throw new Error('기기 시간대에 맞는 진료 시간을 입력해 주세요.');
  }
  if (startsAt.getTime() <= now.getTime()) throw new Error('앞으로 방문할 날짜와 시간을 선택해 주세요.');
  if (state.visits.some(visit => visit.hospitalName === hospitalName && visit.date === input.date && visit.time === input.time)) {
    throw new Error('이미 등록한 진료 일정이에요.');
  }
  const visit: Visit = { id: id('visit', now), hospitalName, date: input.date, time: input.time };
  return { ...state, visits: [...state.visits, visit], visitsRevision: nextVisitRevision(state.visitsRevision, now) };
}

export function removeVisit(state: AppState, visitId: string, now = new Date()): AppState {
  validNow(now);
  const visits = state.visits.filter(visit => visit.id !== visitId);
  if (visits.length === state.visits.length) return state;
  return { ...state, visits, visitsRevision: nextVisitRevision(state.visitsRevision, now) };
}

export function upcomingVisits(state: AppState, now = new Date()): Visit[] {
  validNow(now);
  return state.visits.filter(visit => isUpcomingVisit(visit, now))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

function normalizeHospitalContact(input: HospitalContact): HospitalContact {
  const name = input.name.trim();
  const rawPhone = input.phone.trim();
  const phone = rawPhone.replace(/[ ()-]/g, '');
  let bookingUrl = input.bookingUrl.trim();
  if (!name && !rawPhone && !bookingUrl) return { ...EMPTY_CONTACT };
  if (!isCareName(name, 80)) throw new Error('병원 이름을 1~80자로 입력해 주세요.');
  if (rawPhone && (rawPhone.length > 40 || !/^\+?\d{7,15}$/.test(phone))) {
    throw new Error('병원 전화번호를 확인해 주세요.');
  }
  if (bookingUrl) {
    const invalidUrl = 'https://로 시작하는 병원의 공식 예약 주소를 입력해 주세요.';
    if (bookingUrl.length > 2048 || !/^https:\/\//i.test(bookingUrl) || /[\s\\]/.test(bookingUrl)) throw new Error(invalidUrl);
    try {
      const url = new URL(bookingUrl);
      if (!url.hostname || url.username || url.password || url.href.length > 2048) throw new Error();
      bookingUrl = url.href;
    } catch { throw new Error(invalidUrl); }
  }
  return { name, phone, bookingUrl };
}

function sameContact(a: HospitalContact, b: HospitalContact): boolean {
  return a.name === b.name && a.phone === b.phone && a.bookingUrl === b.bookingUrl;
}

/** Edit (or forget) the current contact without changing previously saved visits. */
export function setHospitalContact(state: AppState, input: HospitalContact, now = new Date()): AppState {
  const hospitalContact = normalizeHospitalContact(input);
  if (sameContact(state.hospitalContact, hospitalContact)) return state;
  if (state.otherHospitalContacts.some(contact => contact.name === hospitalContact.name)) {
    throw new Error('이미 저장한 병원이에요. 진료 일정에서 해당 병원을 선택해 주세요.');
  }
  return { ...state, hospitalContact, hospitalContactsRevision: nextVisitRevision(state.hospitalContactsRevision, now) };
}

/** An explicitly chosen hospital is a default for future visits only. */
export function selectHospital(state: AppState, name: string, phone = '', now = new Date()): AppState {
  const key = name.trim();
  if (!key) throw new Error('병원 이름을 입력해 주세요.');
  const contacts = [state.hospitalContact, ...state.otherHospitalContacts];
  const known = contacts.find(contact => contact.name === key);
  const hospitalContact = normalizeHospitalContact({
    name: key, phone: phone || known?.phone || '', bookingUrl: known?.bookingUrl || '',
  });
  if (sameContact(state.hospitalContact, hospitalContact)) return state;
  return { ...state, hospitalContact,
    otherHospitalContacts: contacts.filter(contact => !!contact.name && contact.name !== key),
    hospitalContactsRevision: nextVisitRevision(state.hospitalContactsRevision, now) };
}

export function hospitalNames(state: AppState): string[] {
  return [...new Set([state.hospitalContact.name, ...state.otherHospitalContacts.map(contact => contact.name),
    ...state.visits.slice().reverse().map(visit => visit.hospitalName)].filter(Boolean))];
}

export function recordDose(state: AppState, doseId: string, taken: boolean, now = new Date(), photo?: DosePhoto): AppState {
  validNow(now);
  const dose = state.doses.find((item) => item.id === doseId);
  if (!dose) throw new Error('복약 일정을 찾을 수 없어요.');
  if (dose.date > localDateKey(now)) throw new Error('미래 날짜의 복약은 아직 기록할 수 없어요.');
  if ((dose.status === 'taken') === taken) return state;
  const capturedPhoto = taken ? normalizeDosePhoto(photo) : undefined;
  if (capturedPhoto) {
    if (Date.parse(capturedPhoto.capturedAt) > now.getTime()) throw new Error('사진 촬영 시간을 확인해 주세요.');
    if (!capturedPhoto.verification) throw new Error('약봉투 사진 확인이 필요해요. 다시 촬영해 주세요.');
    if (Date.parse(capturedPhoto.verification.checkedAt) > now.getTime()) throw new Error('사진 확인 시간을 확인해 주세요.');
    if (state.doses.some(item => item.photo?.id === capturedPhoto.id)) throw new Error('이미 기록에 사용한 사진이에요. 새로 촬영해 주세요.');
  }
  const doses = state.doses.map((item): Dose => {
    if (item.id !== doseId) return item;
    if (taken) return { ...item, status: 'taken', takenAt: now.toISOString(), photo: capturedPhoto };
    const pendingDose: Dose = { ...item, status: 'pending' };
    delete pendingDose.takenAt;
    delete pendingDose.photo;
    return pendingDose;
  });
  return withActivity({ ...state, doses }, `${formatDate(dose.date)} ${dose.time} ${dose.label}${taken ? ' 사진 인증 완료 · 사진과 함께 남긴 환자 자가 기록' : '의 복약 기록을 취소했어요'}`, now);
}

export function normalizePatientName(input: string): string {
  const name = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : '';
  if (!isCareName(name, MAX_PATIENT_NAME)) throw new Error(`이름을 1~${MAX_PATIENT_NAME}자로 입력해 주세요.`);
  return name;
}

export function setPatientName(state: AppState, input: string): AppState {
  const name = normalizePatientName(input);
  if (state.profile?.name === name) return state;
  return { ...state, profile: { ...state.profile, name } };
}

/**
 * Finish first-run setup. A patient with no recorded dose starts now: today's doses whose time
 * has already passed are dropped instead of appearing missed. Upgraded users keep their day.
 */
export function completeSetup(state: AppState, name: string, schedule: MedicationSchedule, now = new Date()): AppState {
  validNow(now);
  const fresh = !state.doses.some(dose => dose.status === 'taken');
  const profile: PatientProfile = { name: normalizePatientName(name), ...(fresh && { startedAt: now.toISOString() }) };
  const scheduled = setMedicationSchedule({ ...state, profile }, schedule, now);
  if (!fresh) return scheduled;
  const today = localDateKey(now);
  return { ...scheduled, doses: [...scheduled.doses.filter(dose => dose.date !== today),
    ...dosesForDate(today, scheduled.medicationSchedule, profile.startedAt)] };
}

export function setSharing(state: AppState, recipient: 'caregiver' | 'hospital', enabled: boolean, now = new Date()): AppState {
  validNow(now);
  if (recipient !== 'caregiver' && recipient !== 'hospital') throw new Error('공유 대상을 확인해 주세요.');
  if (state.sharing[recipient] === enabled) return state;
  return withActivity({ ...state, sharing: { ...state.sharing, [recipient]: enabled } }, `${recipient === 'caregiver' ? '보호자' : '병원'} 복약 기록 공유를 ${enabled ? '허용' : '중지'}했어요`, now);
}

export function setReminderOffsets(state: AppState, kind: ReminderKind, minutes: unknown): AppState {
  const offsets = normalizeReminderOffsets(kind, minutes);
  const field = kind === 'appointment' ? 'appointmentMinutesBefore' : 'medicationMinutesBefore';
  if (state.reminders[field].length === offsets.length && state.reminders[field].every((value, index) => value === offsets[index])) return state;
  return { ...state, reminders: { ...state.reminders, [field]: offsets } };
}

export function visibleDoses(state: AppState, role: Role): Dose[] {
  if (role === 'patient') return state.doses;
  if ((role === 'caregiver' || role === 'hospital') && state.sharing[role]) return state.doses;
  return [];
}

export function ensureDailyDoses(state: AppState, now = new Date()): AppState {
  const today = localDateKey(now);
  // A day's rows are a snapshot. Settings changes must never refill or rewrite it on reload.
  if (state.doses.some(item => item.date === today)) return state;
  const doses = dosesForDate(today, state.medicationSchedule, state.profile?.startedAt);
  // A late setup can leave no dose today; keep the same state rather than rewriting it every refresh.
  return doses.length ? { ...state, doses: [...state.doses, ...doses] } : state;
}

export function setMedicationSchedule(state: AppState, input: MedicationSchedule, now = new Date()): AppState {
  const today = localDateKey(now);
  const medicationSchedule = normalizeMedicationSchedule(input);
  const todayDoses = state.doses.filter(dose => dose.date === today);
  const recordedToday = todayDoses.some(dose => dose.status === 'taken');
  const sameSchedule = state.medicationSchedule.frequency === medicationSchedule.frequency
    && state.medicationSchedule.times.length === medicationSchedule.times.length
    && state.medicationSchedule.times.every((time, index) => time === medicationSchedule.times[index]);
  const replacement = dosesForDate(today, medicationSchedule, state.profile?.startedAt);
  const sameToday = todayDoses.length === replacement.length
    && todayDoses.every((dose, index) => dose.time === replacement[index].time && dose.label === replacement[index].label);
  if (sameSchedule && (recordedToday || sameToday)) return state;
  const doses = recordedToday ? state.doses : [
    ...state.doses.filter(dose => dose.date !== today), ...replacement,
  ];
  return withActivity({ ...state, medicationSchedule, doses },
    `복약 일정을 ${medicationScheduleLabel(medicationSchedule)} ${medicationSchedule.times.join(' · ')}로 변경했어요${recordedToday ? ' · 내일부터 적용' : ''}`, now);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown, maxLength = 10000): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function isDateKey(value: unknown): value is string {
  try { if (typeof value !== 'string') return false; dateParts(value); return true; } catch { return false; }
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function hasIdAndCreatedAt(value: Record<string, unknown>): boolean {
  return isString(value.id, 200) && value.id.length > 0 && isTimestamp(value.createdAt);
}

function validArray(value: unknown, check: (record: Record<string, unknown>) => boolean): boolean {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((item: unknown) => {
    if (!isObject(item) || !isString(item.id, 200) || !item.id || ids.has(item.id) || !check(item)) return false;
    ids.add(item.id);
    return true;
  });
}

/** Reject corrupted device storage instead of trusting its TypeScript cast. */
export function validateLoadedState(value: unknown): AppState {
  const invalid = (): never => { throw new Error('저장된 기록을 읽을 수 없어요.'); };
  if (!isObject(value) || value.version !== 1) return invalid();
  if (!isObject(value.sharing) || typeof value.sharing.caregiver !== 'boolean' || typeof value.sharing.hospital !== 'boolean') return invalid();
  if (!isObject(value.reminders) || typeof value.reminders.appointment !== 'boolean' || typeof value.reminders.medication !== 'boolean') return invalid();
  let appointmentMinutesBefore: number[];
  let medicationMinutesBefore: number[];
  let medicationSchedule: MedicationSchedule;
  let hospitalContact: HospitalContact;
  let otherHospitalContacts: HospitalContact[];
  try {
    appointmentMinutesBefore = normalizeReminderOffsets('appointment', value.reminders.appointmentMinutesBefore === undefined
      ? DEFAULT_REMINDER_OFFSETS.appointment : value.reminders.appointmentMinutesBefore);
    medicationMinutesBefore = normalizeReminderOffsets('medication', value.reminders.medicationMinutesBefore === undefined
      ? DEFAULT_REMINDER_OFFSETS.medication : value.reminders.medicationMinutesBefore);
    medicationSchedule = value.medicationSchedule === undefined
      ? defaultMedicationSchedule() : normalizeMedicationSchedule(value.medicationSchedule);
    hospitalContact = value.hospitalContact === undefined
      ? { ...EMPTY_CONTACT } : normalizeHospitalContact(value.hospitalContact as HospitalContact);
    if (value.otherHospitalContacts !== undefined && !Array.isArray(value.otherHospitalContacts)) return invalid();
    otherHospitalContacts = (value.otherHospitalContacts ?? []).map(normalizeHospitalContact);
    const names = new Set([hospitalContact.name]);
    for (const contact of otherHospitalContacts) {
      if (!contact.name || names.has(contact.name)) return invalid();
      names.add(contact.name);
    }
  } catch { return invalid(); }
  if (!validArray(value.appointments, (item) => hasIdAndCreatedAt(item)
    && LEGACY_DOCTORS.has(item.doctorId) && isDateKey(item.date) && isTime(item.time)
    && (item.status === 'confirmed' || item.status === 'cancelled') && isString(item.reason, 300))) return invalid();
  if (value.visits !== undefined && !validArray(value.visits, item =>
    isCareName(item.hospitalName, 80) && isDateKey(item.date) && isTime(item.time))) return invalid();
  if (value.visitsRevision !== undefined && (typeof value.visitsRevision !== 'number' ||
    !Number.isSafeInteger(value.visitsRevision) || value.visitsRevision < 0)) return invalid();
  if (value.hospitalContactsRevision !== undefined && (typeof value.hospitalContactsRevision !== 'number' ||
    !Number.isSafeInteger(value.hospitalContactsRevision) || value.hospitalContactsRevision < 0)) return invalid();
  if (!validArray(value.doses, (item) => isDateKey(item.date) && isTime(item.time) && isString(item.label, 200) && !!item.label.trim()
    && isString(item.description, 2000) && (item.status === 'pending' || item.status === 'taken')
    && (item.status === 'taken' ? isTimestamp(item.takenAt)
      && (item.photo === undefined || (isDosePhoto(item.photo) && Date.parse(item.photo.capturedAt) <= Date.parse(item.takenAt)
        && (!item.photo.verification || Date.parse(item.photo.verification.checkedAt) <= Date.parse(item.takenAt))))
      : item.takenAt === undefined && item.photo === undefined))) return invalid();
  if (!validArray(value.activity, (item) => hasIdAndCreatedAt(item) && isString(item.text, 500) && !!item.text.trim())) return invalid();
  if (value.profile !== undefined && (!isObject(value.profile) || !Object.keys(value.profile).every(key => key === 'name' || key === 'startedAt')
    || !isCareName(value.profile.name, MAX_PATIENT_NAME)
    || (value.profile.startedAt !== undefined && !isTimestamp(value.profile.startedAt)))) return invalid();
  const state = value as AppState;
  const booked = state.appointments.filter((item) => item.status === 'confirmed').map((item) => `${item.date}-${item.time}`);
  const doses = state.doses.map((item) => `${item.date}-${item.time}`);
  const photos = state.doses.flatMap(item => item.photo ? [item.photo.id] : []);
  if (new Set(booked).size !== booked.length || new Set(doses).size !== doses.length || new Set(photos).size !== photos.length) return invalid();
  const sameOffsets = (existing: unknown, normalized: number[]) => Array.isArray(existing)
    && existing.length === normalized.length && existing.every((item, index) => item === normalized[index]);
  if (sameOffsets(value.reminders.appointmentMinutesBefore, appointmentMinutesBefore)
    && sameOffsets(value.reminders.medicationMinutesBefore, medicationMinutesBefore)
    && value.medicationSchedule !== undefined && state.visits && state.visitsRevision !== undefined && state.hospitalContact
    && sameContact(state.hospitalContact, hospitalContact) && state.hospitalContactsRevision !== undefined
    && state.otherHospitalContacts?.every((contact, index) => sameContact(contact, otherHospitalContacts[index]))) return state;
  // Legacy simulated appointments stay archived and never become actual visit schedules.
  return { ...state, visits: state.visits ?? [], visitsRevision: state.visitsRevision ?? 0, hospitalContact, medicationSchedule,
    otherHospitalContacts, hospitalContactsRevision: state.hospitalContactsRevision ?? 0,
    reminders: { ...state.reminders, appointmentMinutesBefore, medicationMinutesBefore } };
}
