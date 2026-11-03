import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Pool } from 'pg';
import { downloadSharedPhoto, MAX_PHOTO_BYTES, PHOTO_PART_BYTES } from '../shared/care-photo-parts.ts';
import { HttpError } from '../server/care-errors.ts';
import { pruneVercelPhotos, routeVercelPhoto } from '../server/vercel-photos.ts';

const connectionString = process.env.TEST_DATABASE_URL;
test('Postgres photo parts preserve completed versions during retries and remove both completed and pending bytes on withdrawal',
  { skip: !connectionString }, async () => {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    // Disposable schema + rollback: this test never modifies application tables.
    const schema = `care_photo_test_${randomBytes(8).toString('hex')}`;
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}`);
    await client.query('CREATE TABLE metacare_patients (id text PRIMARY KEY)');
    await client.query(await readFile(new URL('../server/vercel-photos.sql', import.meta.url), 'utf8'));
    await client.query("INSERT INTO metacare_patients VALUES ('test-family')");
    const upload = (part: string, body: unknown) => routeVercelPhoto(client, 'test-family', 'picture', ['parts', part], 'PUT', body, 'patient');
    const read = async <T>(path: string) => {
      const parts = path.slice('/v1/caregiver/photos/picture/'.length).split('/');
      const { body } = await routeVercelPhoto(client, 'test-family', 'picture', parts, 'GET', undefined, 'caregiver');
      return body as T;
    };
    const small = Buffer.from([0xff, 0xd8, 0xff, 0x03]).toString('base64');
    const smallPhoto = { bytes: 4, mime: 'image/jpeg', base64: small };
    await upload('0', smallPhoto);
    const large = Buffer.alloc(MAX_PHOTO_BYTES, 0xfc);
    large.set([0xff, 0xd8, 0xff]);
    const first = { bytes: large.length, mime: 'image/jpeg', base64: large.subarray(0, PHOTO_PART_BYTES).toString('base64') };
    const { body } = await upload('0', first);
    const { uploadId } = body as { uploadId: string };
    const load = () => downloadSharedPhoto(read, 'picture', 'fixture', 'parts-v1', () => true);
    assert.equal(await load(), `data:image/jpeg;base64,${small}`);
    const last = { uploadId, base64: large.subarray(PHOTO_PART_BYTES).toString('base64') };
    await assert.rejects(upload('1', { ...last, base64: small }), (e: unknown) => e instanceof HttpError && e.status === 400);
    await upload('1', last);
    await upload('1', last);
    assert.equal(await load(), `data:image/jpeg;base64,${large.toString('base64')}`);
    await upload('0', smallPhoto);
    await assert.rejects(read(`/v1/caregiver/photos/picture/parts/1/${uploadId}`), (e: unknown) => e instanceof HttpError && e.status === 404);
    await assert.rejects(upload('0', { ...smallPhoto, mime: 'image/png' }), (e: unknown) => e instanceof HttpError && e.status === 400);
    await upload('0', first);
    await pruneVercelPhotos(client, 'test-family', []);
    for (const table of ['metacare_photos', 'metacare_photo_uploads']) {
      assert.equal((await client.query(`SELECT count(*) FROM ${table}`)).rows[0].count, '0');
    }
  } finally {
    try { await client.query('ROLLBACK'); }
    finally { client.release(); await pool.end(); }
  }
});
