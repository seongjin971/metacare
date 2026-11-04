import test from 'node:test';
import assert from 'node:assert/strict';
import type { CaregiverData, CareSnapshot, SharedVisit } from '../shared/care-types.ts';
import { medicationCache, upcomingSharedVisits } from '../caregiver/src/visits.ts';

const early: SharedVisit = { hospitalName: '가정의학과', date: '2026-11-05', time: '09:30' };
const later: SharedVisit = { hospitalName: '내과', date: '2026-11-05', time: '16:00' };
const before = new Date('2026-11-05T00:00:00Z');
const snapshot: CareSnapshot = { patientName: '환자', schedule: { frequency: 'once', times: ['08:00'] }, doses: [], updatedAt: before.toISOString(), timeZone: 'Asia/Seoul' };

test('the read-only visit list uses the patient clock, keeps future visits and honors an empty shared agenda', () => {
  const multiple = { ...snapshot, nextVisit: early, upcomingVisits: [later, early] };
  assert.deepEqual(upcomingSharedVisits(multiple, before), [early, later]);
  assert.deepEqual(upcomingSharedVisits(multiple, new Date('2026-11-05T00:30:00Z')), [later]);
  assert.deepEqual(upcomingSharedVisits({ ...snapshot, nextVisit: early }, before), [early]);
  assert.deepEqual(upcomingSharedVisits({ ...snapshot, upcomingVisits: [] }, before), []);
});

test('appointments keep their own clock after the medication timezone changes', () => {
  const live = { ...snapshot, timeZone: 'Australia/Sydney', visitTimeZone: 'Asia/Seoul', upcomingVisits: [early] };
  assert.deepEqual(upcomingSharedVisits(live, before), [early]);
  assert.deepEqual(upcomingSharedVisits(live, new Date('2026-11-05T00:30:00Z')), []);
});

test('legacy visits without a patient timezone follow Seoul time regardless of the viewer timezone', () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'Australia/Sydney';
    const legacy = { ...snapshot, timeZone: undefined, nextVisit: early };
    assert.deepEqual(upcomingSharedVisits(legacy, before), [early]);
    assert.deepEqual(upcomingSharedVisits(legacy, new Date('2026-11-05T00:30:00Z')), []);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('neither the shared agenda nor legacy next visit is retained in the caregiver medication cache', () => {
  const live: CaregiverData = { connectedAt: before.toISOString(), caregiverName: '보호자', snapshot: { ...snapshot, visitTimeZone: 'Asia/Seoul', nextVisit: early, upcomingVisits: [early, later] } };
  assert.deepEqual(medicationCache(live), { ...live, snapshot });
  assert.deepEqual(live.snapshot?.upcomingVisits, [early, later]);
});
