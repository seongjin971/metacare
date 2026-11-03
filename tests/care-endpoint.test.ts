import assert from 'node:assert/strict';
import test from 'node:test';
import { configuredCareEndpoint, serviceSessionKey } from '../shared/care-endpoint.ts';

test('both release apps require an HTTPS service outside device loopback', () => {
  assert.equal(configuredCareEndpoint('https://care.example.org/', false), 'https://care.example.org');
  for (const value of ['http://care.example.org', 'https://localhost.', 'https://127.0.0.2', 'https://[::1]', 'https://10.0.2.2', 'invalid']) {
    assert.throws(() => configuredCareEndpoint(value, false));
  }
  assert.equal(configuredCareEndpoint('http://127.0.0.1:8789', true), 'http://127.0.0.1:8789');
});

test('changing the destination cannot reuse a different server’s saved token', () => {
  const key = 'patient';
  const remote = serviceSessionKey(key, 'https://api.example.org', false);
  assert.equal(serviceSessionKey(key, undefined, true), key);
  assert.notEqual(remote, key);
  assert.equal(serviceSessionKey(key, 'https://API.example.org/', false), remote);
  assert.notEqual(serviceSessionKey(key, 'https://care.example.org', false), remote);
});
