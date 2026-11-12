import assert from 'node:assert/strict';
import test from 'node:test';
import { choosePictureSize } from '../src/picture-size.ts';

test('chooses the largest capture size within the sharing-safe pixel budget', () => {
  assert.equal(choosePictureSize(['8160x6120', '4000x3000', '3264x2448', '1920x1080', '640x480']), '3264x2448');
  assert.equal(choosePictureSize(['Photo', 'High', '3840x2160', '1920x1080']), '3840x2160');
});

test('keeps the camera default when no size is usable', () => {
  assert.equal(choosePictureSize([]), undefined);
  assert.equal(choosePictureSize(['Photo', 'High', 'Medium']), undefined);
  assert.equal(choosePictureSize(['8160x6120', '640x480']), undefined);
});
