import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import type { Patient } from '../server/care-core.ts';
import { migrateCare } from '../server/migrate-care.ts';
import { RetryablePushError, type OverdueJob, type OverdueSettings } from '../server/overdue.ts';
import { getOverdueSettings, processOverdueJob, reconcileOverdue, setOverdueSettings } from '../server/vercel-overdue.ts';

const database = process.env.TEST_DATABASE_URL;
test('durable deadlines survive closed apps and repeated queue delivery, but stop on record, opt-out and unlink', { skip: !database }, async t => {
  const schema = 'overdue_' + randomBytes(10).toString('hex');
  const admin = new Pool({ connectionString: database });
  await admin.query('CREATE SCHEMA ' + schema);
  const pool = new Pool({ connectionString: database, options: '-c search_path=' + schema });
  t.after(async () => { await pool.end(); await admin.query('DROP SCHEMA ' + schema + ' CASCADE'); await admin.end(); });
  await migrateCare(pool);
  let now = Date.parse('2026-11-03T09:50:00+09:00');
  const family: Pick<Patient, 'id' | 'caregiver' | 'snapshot'> = {
    id: 'testing', caregiver: { tokenHash: 'caregiver-test-key', connectedAt: new Date(now).toISOString(), name: '보호자' },
    snapshot: { patientName: '환자', schedule: { frequency: 'twice', times: ['10:00', '19:00'] }, doses: [], updatedAt: new Date(now).toISOString() },
  };
  await pool.query('INSERT INTO metacare_patients(id, token_hash, snapshot, caregiver) VALUES($1,$2,$3,$4)',
    [family.id, 'patient-test-key', family.snapshot, family.caregiver]);
  const queue: OverdueJob[] = [];
  const enqueue = async (job: OverdueJob) => { queue.push(job); };
  const enabled: OverdueSettings = { enabled: true, threshold: 30, expoPushToken: 'ExpoPushToken[abcdefgh12345]' };
  async function change(prefs?: OverdueSettings, failQueue = false) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE metacare_patients SET snapshot=$2, caregiver=$3 WHERE id=$1', [family.id, family.snapshot, family.caregiver]);
      if (prefs) await setOverdueSettings(client, family, prefs, now, failQueue ? async () => { throw new Error('queue unavailable'); } : enqueue);
      else await reconcileOverdue(client, family, now, enqueue);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  const instance = await pool.connect();
  try {
    await assert.rejects(change(enabled, true), /queue unavailable/);
    assert.deepEqual(await getOverdueSettings(instance, family), { enabled: false, threshold: 30 });
  } finally { instance.release(); }
  await change(enabled);
  const first = queue[0];
  await change(enabled);
  await change({ ...enabled, expoPushToken: 'ExpoPushToken[rotated12345]' });
  assert.equal(queue.length, 1, 'token rotations and repeated submissions keep the same timer');
  let sent = 0;
  const send = async (token: string) => {
    assert.equal(token, 'ExpoPushToken[rotated12345]');
    sent++;
    return 'accepted' as const;
  };
  const run = (job: OverdueJob) => processOverdueJob(pool, job, enqueue, send, () => now);
  now = first.dueAt;
  await Promise.all([run(first), run(first)]);
  assert.equal(sent, 1);
  assert.equal(queue.length, 2, 'callback schedules the next check without another app request');
  const evening = queue[1];
  family.snapshot!.doses = [
    { id: 'evening', date: evening.date, time: evening.time, label: '저녁', status: 'taken', takenAt: new Date(evening.dueAt - 1000).toISOString() },
  ];
  await change();
  now = evening.dueAt;
  await run(evening);
  assert.equal(sent, 1, 'upload between enqueue and delivery suppresses notification');

  const tomorrow = queue.at(-1)!;
  await change({ ...enabled, threshold: 15 });
  await run(tomorrow);
  assert.equal(sent, 1, 'stale timed task after threshold change is ignored');
  const adjusted = queue.at(-1)!;
  now = adjusted.dueAt;
  let attempts = 0;
  const limited = async () => { if (++attempts === 1) throw new RetryablePushError(); return 'accepted' as const; };
  await assert.rejects(processOverdueJob(pool, adjusted, enqueue, limited, () => now), RetryablePushError);
  await processOverdueJob(pool, adjusted, enqueue, limited, () => now);
  await processOverdueJob(pool, adjusted, enqueue, limited, () => now);
  assert.equal(attempts, 2);
  const uncertain = queue.at(-1)!;
  now = uncertain.dueAt;
  let ambiguousAttempts = 0;
  const lostResponse = async (): Promise<'accepted'> => { ambiguousAttempts++; throw new Error('connection reset'); };
  await assert.rejects(processOverdueJob(pool, uncertain, enqueue, lostResponse, () => now), /connection reset/);
  await processOverdueJob(pool, uncertain, enqueue, lostResponse, () => now);
  assert.equal(ambiguousAttempts, 1);
  const optOut = queue.at(-1)!;
  await change({ enabled: false, threshold: 60 });
  now = optOut.dueAt;
  await run(optOut);
  assert.equal(sent, 1, 'disabled alert never reaches a previous token');
  await change(enabled);
  const disconnected = queue.at(-1)!;
  family.caregiver = null;
  await change();
  now = disconnected.dueAt;
  await run(disconnected);
  assert.equal(sent, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM metacare_overdue_deliveries')).rows[0].n, 0);
});
