import assert from 'node:assert/strict';
import test from 'node:test';
import type { Dose } from '../src/domain.ts';
import { doseTiming, lateText, nextDose } from '../src/dose-timing.ts';

const dose = (time: string, status: Dose['status'] = 'pending'): Dose => ({
  id: `dose-2026-11-12-${time.replace(':', '')}`, date: '2026-11-12', time, label: '복용약', description: '', status,
  ...(status === 'taken' ? { takenAt: '2026-11-12T00:00:00.000Z' } : {}),
});
const at = (time: string) => new Date(2026, 10, 12, Number(time.slice(0, 2)), Number(time.slice(3)));

test('a dose is due around its time and overdue after the caregiver grace period', () => {
  assert.equal(doseTiming(dose('13:00'), at('12:40')).state, 'due');
  assert.equal(doseTiming(dose('13:00'), at('13:29')).state, 'due');
  assert.equal(doseTiming(dose('13:00'), at('13:30')).state, 'overdue');
  assert.equal(doseTiming(dose('19:00'), at('13:04')).state, 'upcoming');
});

test('the next dose is the earliest unrecorded one, so a missed morning dose comes first', () => {
  const doses = [dose('19:00'), dose('08:00'), dose('13:00')];
  const next = nextDose(doses, at('13:04'));
  assert.equal(next?.dose.time, '08:00');
  assert.equal(next?.state, 'overdue');
  assert.equal(next?.minutesLate, 304);
  assert.equal(nextDose([dose('08:00', 'taken'), dose('13:00')], at('13:04'))?.dose.time, '13:00');
  assert.equal(nextDose([dose('08:00', 'taken')], at('13:04')), null);
});

test('late text reads naturally in Korean', () => {
  assert.equal(lateText(45), '45분 지났어요');
  assert.equal(lateText(120), '2시간 지났어요');
  assert.equal(lateText(304), '5시간 4분 지났어요');
});
