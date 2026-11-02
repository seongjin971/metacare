import type { Invite, PatientConnection } from '../shared/care-types.ts';

type VisitConsent = NonNullable<PatientConnection['visitConsent']>;
type VisitPreference = VisitConsent & { connectedAt: string; pending?: boolean };

export type PatientSharingSession = {
  token: string;
  patientName: string;
  consentVersion: 1;
  active: boolean;
  invite?: Invite;
  lastSync?: string;
  wasConnected?: boolean;
  pendingRevoke?: boolean;
  visitPreference?: VisitPreference;
};

export function readPatientSharingSession(value: unknown): PatientSharingSession | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<PatientSharingSession>;
  if (typeof item.token !== 'string' || !item.token || item.consentVersion !== 1
    || typeof item.patientName !== 'string' || !item.patientName.trim() || item.patientName.length > 40
    || typeof item.active !== 'boolean') return null;
  const preference = item.visitPreference;
  const validPreference = item.active && !item.pendingRevoke && item.wasConnected === true && preference
    && typeof preference.connectedAt === 'string' && Number.isFinite(Date.parse(preference.connectedAt))
    && Number.isSafeInteger(preference.revision) && preference.revision > 0 && typeof preference.enabled === 'boolean';
  return {
    token: item.token, patientName: item.patientName, consentVersion: 1, active: item.active && item.pendingRevoke !== true,
    ...(item.invite && /^\d{8}$/.test(item.invite.code) && Number.isFinite(Date.parse(item.invite.expiresAt)) ? { invite: item.invite } : {}),
    ...(item.lastSync && Number.isFinite(Date.parse(item.lastSync)) ? { lastSync: item.lastSync } : {}),
    ...(item.wasConnected === true ? { wasConnected: true } : {}),
    ...(item.pendingRevoke === true ? { pendingRevoke: true } : {}),
    ...(validPreference ? { visitPreference: { connectedAt: preference.connectedAt, enabled: preference.enabled, revision: preference.revision, pending: preference.pending === true } } : {}),
  };
}

/** Withdrawal takes effect locally even when the server cannot acknowledge it yet. */
export function requestPatientRevocation(session: PatientSharingSession): PatientSharingSession {
  const pending = { ...session, active: false, pendingRevoke: true };
  delete pending.visitPreference;
  return pending;
}

/** Prefer the latest choice for this pairing. A tie between opposing choices always keeps the visit private. */
export function reconcileVisitConsent(session: PatientSharingSession, connectedAt: string, remote?: VisitConsent): PatientSharingSession {
  const stored = session.visitPreference;
  const local = stored?.connectedAt === connectedAt ? stored : undefined;
  if (remote && (!local || remote.revision > local.revision ||
    (remote.revision === local.revision && !remote.enabled && local.enabled))) {
    return { ...session, visitPreference: { ...remote, connectedAt } };
  }
  if (stored && !local) {
    const next = { ...session };
    delete next.visitPreference;
    return next;
  }
  return session;
}

/** Only call after the server acknowledges revocation or reports the guardian disconnected. */
export function completePatientRevocation(session: PatientSharingSession): PatientSharingSession {
  return { token: session.token, patientName: session.patientName, consentVersion: 1, active: false };
}
