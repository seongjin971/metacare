import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadSharedPhoto, MAX_PHOTO_BYTES, PHOTO_PART_BYTES, uploadSharedPhoto } from '../shared/care-photo-parts.ts';

const version = '0123456789abcdef0123456789abcdef';
const active = () => true;
const makeUri = (bytes: number) => {
  const pixels = Buffer.alloc(bytes, 0xe7);
  pixels.set([0xff, 0xd8, 0xff]);
  return `data:image/jpeg;base64,${pixels.toString('base64')}`;
};

test('a full 5 MiB photo round-trips byte-for-byte without a single request or response reaching 4.5 MB', async () => {
  const uri = makeUri(MAX_PHOTO_BYTES);
  const chunks: string[] = [];
  const upload = async <T>(path: string, options: { token: string; body?: unknown }) => {
    assert.equal(options.token, 'patient');
    assert.equal(path, `/v1/patient/photos/test/parts/${chunks.length}`);
    assert.ok(Buffer.byteLength(JSON.stringify(options.body)) < 4_500_000);
    const photo = options.body as { bytes?: number; base64: string; uploadId?: string };
    if (!chunks.length) assert.equal(photo.bytes, MAX_PHOTO_BYTES);
    else assert.equal(photo.uploadId, version);
    chunks.push(photo.base64);
    return { uploadId: version } as T;
  };
  assert.equal(await uploadSharedPhoto(upload, 'test', 'patient', uri, 'parts-v1', active), true);
  assert.equal(chunks.length, 2);
  const download = async <T>(path: string, options: { token: string }) => {
    assert.equal(options.token, 'guardian');
    const urls = ['/v1/caregiver/photos/test/parts/0', `/v1/caregiver/photos/test/parts/1/${version}`];
    assert.ok(urls.includes(path));
    const reply = { mime: 'image/jpeg', bytes: MAX_PHOTO_BYTES, base64: chunks[urls.indexOf(path)], version };
    assert.ok(Buffer.byteLength(JSON.stringify(reply)) < 4_500_000);
    return reply as T;
  };
  assert.equal(await downloadSharedPhoto(download, 'test', 'guardian', 'parts-v1', active), uri);
});

test('revocation between photo parts stops uploads and discards an interrupted download', async () => {
  const uri = makeUri(PHOTO_PART_BYTES + 1);
  let allowed = true;
  let requests = 0;
  const revokeAfterFirst = async <T>() => {
    allowed = false;
    requests += 1;
    return { uploadId: version } as T;
  };
  assert.equal(await uploadSharedPhoto(revokeAfterFirst, 'test', 'patient', uri, 'parts-v1', () => allowed), false);
  allowed = true;
  assert.equal(await downloadSharedPhoto(revokeAfterFirst, 'test', 'guardian', 'parts-v1', () => allowed), null);
  assert.equal(requests, 2);
  await assert.rejects(uploadSharedPhoto(revokeAfterFirst, 'test', 'patient', makeUri(MAX_PHOTO_BYTES + 1), 'parts-v1', active), /5 MiB/);
  assert.equal(requests, 2);
});

test('inconsistent photo versions cannot be combined into an image', async () => {
  const base64 = Buffer.alloc(PHOTO_PART_BYTES).toString('base64');
  const download = async <T>(path: string) => ({
    mime: 'image/jpeg', bytes: PHOTO_PART_BYTES + 1,
    base64: path.endsWith('/0') ? base64 : 'AA==',
    version: path.endsWith('/0') ? version : 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  } as T);
  await assert.rejects(downloadSharedPhoto(download, 'test', 'guardian', 'parts-v1', active), /변경/);
});
