import assert from 'node:assert/strict';
import test from 'node:test';
import { savePhotoRecord } from '../src/save-photo-record.ts';
import { photoFor } from './fixtures.ts';

const capture = { uri: 'camera-only-capture' };
const photo = photoFor(new Date(2026, 9, 28, 8));

test('closing or backgrounding during pixel save prevents recording and cleans up', async () => {
  let active = true;
  let committed = false;
  const removed: string[] = [];
  const saved = await savePhotoRecord(capture, {
    savePhoto: async () => { active = false; return photo; },
    canCommit: () => active,
    commitRecord: async () => { committed = true; return true; },
    removePhoto: async value => { removed.push(value.id); },
  });
  assert.equal(saved, false);
  assert.equal(committed, false);
  assert.deepEqual(removed, [photo.id]);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('photo storage failure never attempts the metadata commit', async () => {
  const failure = new Error('disk full');
  let commits = 0;
  let removals = 0;
  await assert.rejects(savePhotoRecord(capture, {
    savePhoto: async received => { assert.equal(received, capture); throw failure; },
    commitRecord: async () => { commits += 1; return true; },
    removePhoto: async () => { removals += 1; },
  }), error => error === failure);
  assert.equal(commits, 0);
  // No managed photo reference was returned, so cleanup belongs to the storage adapter.
  assert.equal(removals, 0);
});

test('metadata commit returning false removes the stored photo before returning failure', async () => {
  const events: string[] = [];
  const cleanup = deferred<void>();
  let settled = false;
  const result = savePhotoRecord(capture, {
    savePhoto: async () => { events.push('photo saved'); return photo; },
    commitRecord: async saved => { assert.equal(saved, photo); events.push('commit failed'); return false; },
    removePhoto: async saved => { assert.equal(saved, photo); events.push('cleanup started'); await cleanup.promise; events.push('cleanup finished'); },
  });
  void result.then(() => { settled = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(events, ['photo saved', 'commit failed', 'cleanup started']);
  cleanup.resolve();
  assert.equal(await result, false);
  assert.deepEqual(events, ['photo saved', 'commit failed', 'cleanup started', 'cleanup finished']);
});

test('rejected metadata commit cleans up and preserves the original failure', async () => {
  const failure = new Error('state write rejected');
  const removed: string[] = [];
  await assert.rejects(savePhotoRecord(capture, {
    savePhoto: async () => photo,
    commitRecord: async () => { throw failure; },
    removePhoto: async saved => { removed.push(saved.id); },
  }), error => error === failure);
  assert.deepEqual(removed, [photo.id]);
});

test('cleanup failure cannot report success or hide a rejected metadata commit', async () => {
  let cleanupAttempts = 0;
  const removePhoto = async () => { cleanupAttempts += 1; throw new Error('cleanup unavailable'); };
  assert.equal(await savePhotoRecord(capture, {
    savePhoto: async () => photo,
    commitRecord: async () => false,
    removePhoto,
  }), false);
  const commitFailure = new Error('commit unavailable');
  await assert.rejects(savePhotoRecord(capture, {
    savePhoto: async () => photo,
    commitRecord: async () => { throw commitFailure; },
    removePhoto,
  }), error => error === commitFailure);
  assert.equal(cleanupAttempts, 2);
});

test('success waits for both pixel storage and asynchronous metadata commit without deleting the photo', async () => {
  const pixelSave = deferred<typeof photo>();
  const metadataSave = deferred<boolean>();
  const events: string[] = [];
  let settled = false;
  const result = savePhotoRecord(capture, {
    savePhoto: async () => { events.push('photo started'); return pixelSave.promise; },
    commitRecord: async saved => { assert.equal(saved, photo); events.push('commit started'); return metadataSave.promise; },
    removePhoto: async () => { events.push('unexpected cleanup'); },
  });
  void result.then(() => { settled = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(events, ['photo started']);
  pixelSave.resolve(photo);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(events, ['photo started', 'commit started']);
  metadataSave.resolve(true);
  assert.equal(await result, true);
  assert.deepEqual(events, ['photo started', 'commit started']);
});
