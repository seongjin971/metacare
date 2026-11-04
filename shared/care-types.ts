/** The consented, minimal record shared between the two separate applications. */
export type SharedDose = {
  id: string;
  date: string;
  time: string;
  label: string;
  status: 'pending' | 'taken';
  takenAt?: string;
  photo?: { id: string; capturedAt: string; verified: boolean };
};

/** The hospital and patient-local time, without contact or booking details. */
export type SharedVisit = { hospitalName: string; date: string; time: string };
export type PhotoTransfer = 'parts-v1';

export type CareSnapshot = {
  patientName: string;
  /** IANA zone for the patient's daily wall-clock medication times. */
  timeZone?: string;
  /** Wall-clock zone of the shared visit schedule, independent of medication updates. */
  visitTimeZone?: string;
  schedule: { frequency: 'once' | 'twice' | 'three'; times: string[] };
  doses: SharedDose[];
  nextVisit?: SharedVisit;
  upcomingVisits?: SharedVisit[];
  updatedAt: string;
};

export type SnapshotInput = Omit<CareSnapshot, 'updatedAt' | 'visitTimeZone'>;
/** A visit preference belongs to one pairing. Medication-only clients send no visit update. */
export type VisitUpdate = {
  connectedAt: string;
  consentRevision: number;
  enabled: boolean;
  /** Older consents authorize only nextVisit. */
  scope?: 'upcoming';
  scheduleRevision: number;
};
export type PatientSnapshotUpdate = SnapshotInput & { visitUpdate?: VisitUpdate };
export type PatientSession = { token: string };
export type Invite = { code: string; expiresAt: string };
export type PatientConnection = {
  sharingRevoked?: boolean;
  caregiverName: string | null;
  connectedAt: string | null;
  photoTransfer?: PhotoTransfer;
  visitConsent?: { revision: number; enabled: boolean; scope?: 'upcoming' };
};
export type CaregiverSession = { token: string; patientName: string };
export type CaregiverData = { snapshot: CareSnapshot | null; connectedAt: string; caregiverName: string; photoTransfer?: PhotoTransfer };
