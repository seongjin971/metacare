import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

export async function migrateCare(pool: Pool) {
  const files = ['./vercel-care.sql', './vercel-photos.sql', './vercel-overdue.sql'];
  const statements = await Promise.all(files.map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(52658102)');
    for (const sql of statements) await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL for the target MetaCare database.');
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 8000 });
  try {
    await migrateCare(pool);
    console.log('MetaCare database schema is ready.');
  } finally {
    await pool.end();
  }
}
