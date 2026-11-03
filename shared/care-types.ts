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

/** Only the separately consented next visit, without contact or booking details. */
export type SharedVisit = { hospitalName: string; date: string; time: string };
export type PhotoTransfer = 'parts-v1';

export type CareSnapshot = {
  patientName: string;
  schedule: { frequency: 'once' | 'twice' | 'three'; times: string[] };
  doses: SharedDose[];
  nextVisit?: SharedVisit;
  updatedAt: string;
};

export type SnapshotInput = Omit<CareSnapshot, 'updatedAt'>;
/** A visit preference belongs to one pairing. Medication-only clients send no visit update. */
export type VisitUpdate = {
  connectedAt: string;
  consentRevision: number;
  enabled: boolean;
  scheduleRevision: number;
};
export type PatientSnapshotUpdate = SnapshotInput & { visitUpdate?: VisitUpdate };
export type PatientSession = { token: string };
export type Invite = { code: string; expiresAt: string };
export type PatientConnection = {
  caregiverName: string | null;
  connectedAt: string | null;
  photoTransfer?: PhotoTransfer;
  visitConsent?: { revision: number; enabled: boolean };
};
export type CaregiverSession = { token: string; patientName: string };
export type CaregiverData = { snapshot: CareSnapshot | null; connectedAt: string; caregiverName: string; photoTransfer?: PhotoTransfer };
