import { send } from '@vercel/queue';
import { Pool } from 'pg';

let pool;
export function carePool() {
  if (!process.env.DATABASE_URL) throw new Error('Database not configured.');
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3,
      idleTimeoutMillis: 5000, connectionTimeoutMillis: 5000, allowExitOnIdle: true });
    pool.on('error', () => console.warn('MetaCare database closed an idle connection.'));
  }
  return pool;
}

export async function enqueueOverdue(job) {
  await send('metacare-overdue', job, { delaySeconds: Math.max(0, Math.ceil((job.dueAt - Date.now()) / 1000)),
    retentionSeconds: 604800, idempotencyKey: job.generation });
}
