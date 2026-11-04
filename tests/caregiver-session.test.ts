import assert from 'node:assert/strict';
import test from 'node:test';
import { completePatientRevocation, readPatientSharingSession, reconcileVisitConsent, requestPatientRevocation, type PatientSharingSession } from '../src/caregiver-session.ts';

const active: PatientSharingSession = {
  token: 'patient-credential', patientName: '환자', consentVersion: 1, active: true, wasConnected: true,
  invite: { code: '12345678', expiresAt: '2026-11-01T12:00:00.000Z' }, lastSync: '2026-11-01T11:00:00.000Z',
};

test('withdrawal immediately stops local publication and preserves the credential for cleanup retries', () => {
  const pending = requestPatientRevocation(active);
  assert.equal(pending.active, false);
  assert.equal(pending.pendingRevoke, true);
  assert.equal(pending.token, active.token);
  assert.equal(active.active, true);
  assert.deepEqual(readPatientSharingSession(JSON.parse(JSON.stringify(pending))), pending);
});

test('pending revocation always wins over active=true after reloading persisted state', () => {
  const reloaded = readPatientSharingSession({ ...active, pendingRevoke: true });
  assert.equal(reloaded?.active, false);
  assert.equal(reloaded?.pendingRevoke, true);
});

test('acknowledged revocation clears invite and retry state without discarding the patient identity', () => {
  const complete = completePatientRevocation(requestPatientRevocation(active));
  assert.deepEqual(complete, { token: active.token, patientName: active.patientName, consentVersion: 1, active: false });
  assert.deepEqual(readPatientSharingSession(complete), complete);
});

test('legacy toggles and incomplete credentials never authorize sharing', () => {
  for (const value of [true, { caregiver: true }, { active: true }, { ...active, consentVersion: undefined }, { ...active, token: '' }, { ...active, active: 'true' }]) {
    assert.equal(readPatientSharingSession(value), null);
  }
});

test('visit sharing is opt-in for the current paired guardian and resets on withdrawal', () => {
  const connectedAt = '2026-11-01T10:00:00.000Z';
  const enabled = { ...active, visitPreference: { connectedAt, enabled: true, revision: 100, pending: true } };
  assert.equal(readPatientSharingSession(active)?.visitPreference, undefined);
  assert.deepEqual(readPatientSharingSession(enabled)?.visitPreference, enabled.visitPreference);
  assert.equal(readPatientSharingSession({ ...enabled, wasConnected: false })?.visitPreference, undefined);
  assert.equal(readPatientSharingSession({ ...enabled, visitPreference: { ...enabled.visitPreference, enabled: 'true' } })?.visitPreference, undefined);
  assert.equal(requestPatientRevocation(enabled).visitPreference, undefined);
  assert.equal(completePatientRevocation(enabled).visitPreference, undefined);
  assert.equal(reconcileVisitConsent(enabled, '2026-11-03T10:00:00.000Z').visitPreference, undefined);
  assert.equal(reconcileVisitConsent(enabled, connectedAt, { enabled: false, revision: 99 }), enabled);
  assert.equal(reconcileVisitConsent(enabled, connectedAt, { enabled: false, revision: 100 }).visitPreference?.enabled, false);
  assert.equal(reconcileVisitConsent(enabled, connectedAt, { enabled: false, revision: 101 }).visitPreference?.enabled, false);
});

test('upcoming scope persists only for the consenting pairing and reconciles with the confirmed scope', () => {
  const connectedAt = '2026-11-01T10:00:00.000Z';
  const legacy = { ...active, visitPreference: { connectedAt, enabled: true, revision: 100 } };
  const agenda = { ...active, visitPreference: { ...legacy.visitPreference, scope: 'upcoming' as const, revision: 101, pending: true } };
  assert.equal(readPatientSharingSession(legacy)?.visitPreference?.scope, undefined);
  assert.deepEqual(readPatientSharingSession(agenda)?.visitPreference, agenda.visitPreference);
  assert.equal(reconcileVisitConsent(agenda, connectedAt, { enabled: true, revision: 100 }), agenda);
  assert.equal(reconcileVisitConsent(agenda, connectedAt, { enabled: true, revision: 101 }).visitPreference?.scope, undefined);
  assert.equal(reconcileVisitConsent(legacy, connectedAt, { enabled: true, scope: 'upcoming', revision: 101 }).visitPreference?.scope, 'upcoming');
  assert.equal(reconcileVisitConsent(agenda, connectedAt, { enabled: false, revision: 101 }).visitPreference?.enabled, false);
  assert.equal(reconcileVisitConsent(agenda, '2026-11-02T10:00:00.000Z').visitPreference, undefined);
  assert.equal(requestPatientRevocation(agenda).visitPreference, undefined);
  assert.equal(readPatientSharingSession({ ...agenda, visitPreference: { ...agenda.visitPreference, scope: 'other' } })?.visitPreference, undefined);
});
