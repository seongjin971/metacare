import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Patient } from './care-core.ts';
import { HttpError } from './care-errors.ts';
import {
  checkRegistration, eligibleOverdueSlot, isOverdueJob, nextOverdueSlot, RetryablePushError, sendOverduePush,
  type EnqueueOverdue, type OverdueJob, type OverdueSettings,
} from './overdue.ts';

type Family = Pick<Patient, 'id' | 'snapshot' | 'caregiver'>;
type Registration = {
  pair_hash: string; subscription_key: string; threshold: number; push_token: string | null; time_zone: string | null; next_job: OverdueJob | null;
};
const columns = 'pair_hash, subscription_key, threshold, push_token, time_zone, next_job';

async function registration(client: PoolClient, patient: Family) {
  const result = await client.query<Registration>(
    'SELECT ' + columns + ' FROM metacare_overdue_settings WHERE patient_id=$1 AND pair_hash=$2 FOR UPDATE',
    [patient.id, patient.caregiver?.tokenHash],
  );
  return result.rows[0];
}

export async function getOverdueSettings(client: PoolClient, patient: Family) {
  const row = await registration(client, patient);
  return { enabled: !!row?.push_token, threshold: row?.threshold ?? 30, ...(row?.push_token && { registrationId: row.subscription_key }) };
}

// The caller holds the family lock and transaction. A successful publish followed by a
// rolled-back transaction leaves an inert random generation. A failed publish aborts the
// transaction so a reported success never depends on a future best-effort enqueue.
async function schedule(client: PoolClient, patient: Family, row: Registration, now: number, enqueue: EnqueueOverdue, completed = false) {
  const previous = row.next_job;
  const after = completed || !previous ? now : Math.min(now, previous.dueAt - 1);
  const next = nextOverdueSlot(patient.snapshot, row.threshold, after, row.time_zone ?? undefined, completed ? previous ?? undefined : undefined);
  if (previous && next && previous.dueAt === next.dueAt && previous.date === next.date && previous.time === next.time) return;
  const future = !completed && next && next.dueAt <= now
    ? nextOverdueSlot(patient.snapshot, row.threshold, now, row.time_zone ?? undefined) : next;
  if (!previous && !future) return;
  const job = future && { ...future, patientId: patient.id, generation: randomUUID() };
  if (job) await enqueue(job);
  await client.query('UPDATE metacare_overdue_settings SET next_job=$2 WHERE patient_id=$1', [patient.id, job]);
}

export async function reconcileOverdue(client: PoolClient, patient: Family, now: number, enqueue: EnqueueOverdue) {
  if (!patient.caregiver) {
    await client.query('DELETE FROM metacare_overdue_settings WHERE patient_id=$1', [patient.id]);
    return;
  }
  const row = await registration(client, patient);
  if (row?.push_token) await schedule(client, patient, row, now, enqueue);
}

export async function setOverdueSettings(client: PoolClient, patient: Family, prefs: OverdueSettings, now: number, enqueue: EnqueueOverdue) {
  if (!patient.caregiver) throw new HttpError(401, '보호자 연결을 확인해 주세요.');
  const current = await registration(client, patient);
  checkRegistration(prefs.expectedRegistrationId, current?.push_token ? current.subscription_key : null);
  const token = prefs.enabled ? prefs.expoPushToken : null;
  if (token) {
    // The same installation can be re-paired or restored; send only for its current family.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 41))', [token]);
    await client.query('UPDATE metacare_overdue_settings SET push_token=NULL, next_job=NULL WHERE push_token=$1 AND patient_id<>$2',
      [token, patient.id]);
  }
  await client.query('DELETE FROM metacare_overdue_settings WHERE patient_id=$1 AND pair_hash<>$2', [patient.id, patient.caregiver.tokenHash]);
  const result = await client.query<Registration>(
    `INSERT INTO metacare_overdue_settings(patient_id,pair_hash,threshold,push_token,time_zone,subscription_key) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(patient_id) DO UPDATE SET threshold=EXCLUDED.threshold, push_token=EXCLUDED.push_token,
       time_zone=COALESCE(EXCLUDED.time_zone,metacare_overdue_settings.time_zone),
       subscription_key=CASE WHEN metacare_overdue_settings.push_token IS DISTINCT FROM EXCLUDED.push_token THEN EXCLUDED.subscription_key
                             ELSE metacare_overdue_settings.subscription_key END,
       next_job=CASE WHEN EXCLUDED.push_token IS NULL THEN NULL ELSE metacare_overdue_settings.next_job END
     RETURNING ` + columns, [patient.id, patient.caregiver.tokenHash, prefs.threshold, token, prefs.timeZone ?? null, randomUUID()],
  );
  if (!token) await client.query('DELETE FROM metacare_overdue_deliveries WHERE patient_id=$1 AND claimed=false', [patient.id]);
  if (token) await schedule(client, patient, result.rows[0], now, enqueue);
  return { enabled: prefs.enabled, threshold: prefs.threshold, ...(token && { registrationId: result.rows[0].subscription_key }) };
}

async function inTransaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function familyAndRegistration(client: PoolClient, id: string) {
  const { rows } = await client.query<Family>('SELECT id, snapshot, caregiver FROM metacare_patients WHERE id=$1 FOR UPDATE', [id]);
  const patient = rows[0];
  if (!patient?.caregiver) return null;
  const row = await registration(client, patient);
  return row?.push_token ? { patient, row } : null;
}

export async function processOverdueJob(pool: Pool, job: OverdueJob, enqueue: EnqueueOverdue,
  send: typeof sendOverduePush = sendOverduePush, now: () => number = Date.now) {
  if (!isOverdueJob(job)) throw new Error('Invalid overdue job.');
  const key = [job.patientId, job.date, job.time, job.generation];
  const slotKey = 'patient_id=$1 AND dose_date=$2 AND dose_time=$3 AND generation=$4';
  const subscription = await inTransaction(pool, async client => {
    const current = await familyAndRegistration(client, job.patientId);
    if (!current) return null;
    const { patient, row } = current;
    const time = now();
    if (row.next_job?.generation === job.generation) {
      const scheduled = row.next_job;
      if (scheduled.date !== job.date || scheduled.time !== job.time || scheduled.dueAt !== job.dueAt) return null;
      if (time < job.dueAt) throw new Error('Notification is not due yet.');
      await schedule(client, patient, row, time, enqueue, true);
      // Keep recent receipts across opt-out, threshold edits and token refreshes.
      await client.query("DELETE FROM metacare_overdue_deliveries WHERE patient_id=$1 AND dose_date < $2::date - 7", [patient.id, job.date]);
      if (eligibleOverdueSlot(patient.snapshot, row.threshold, job, time, row.time_zone ?? undefined)) {
        await client.query(
          `INSERT INTO metacare_overdue_deliveries(patient_id,dose_date,dose_time,generation) VALUES($1,$2,$3,$4)
           ON CONFLICT(patient_id,dose_date,dose_time) DO NOTHING`, key,
        );
      }
    }
    // Commit the claim before contacting the remote service. If the connection breaks after
    // it accepts the message, a redelivered queue job cannot send it again.
    const claim = await client.query('UPDATE metacare_overdue_deliveries SET claimed=true WHERE ' + slotKey + ' AND claimed=false RETURNING generation', key);
    return claim.rowCount ? row.subscription_key : null;
  });
  if (!subscription) return;

  const retry = await inTransaction(pool, async client => {
    const current = await familyAndRegistration(client, job.patientId);
    if (!current || current.row.subscription_key !== subscription) return false;
    const { patient, row } = current;
    if (!eligibleOverdueSlot(patient.snapshot, row.threshold, job, now(), row.time_zone ?? undefined)) return false;
    // Snapshot updates and unlink/opt-out take the same locks as this final check.
    try {
      const result = await send(row.push_token!, job, patient.caregiver!.connectedAt);
      if (result === 'unregistered') {
        await client.query('UPDATE metacare_overdue_settings SET push_token=NULL, next_job=NULL WHERE patient_id=$1', [patient.id]);
      }
    } catch (error) {
      if (!(error instanceof RetryablePushError)) throw error;
      await client.query('UPDATE metacare_overdue_deliveries SET claimed=false WHERE ' + slotKey, key);
      return true;
    }
    return false;
  });
  if (retry) throw new RetryablePushError('Expo refused the message. Retry the queue job.');
}
