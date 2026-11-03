import assert from 'node:assert/strict';
import test from 'node:test';
import { configuredCareEndpoint, serviceSessionKey } from '../shared/care-endpoint.ts';

test('release apps require a named HTTPS service outside local networks', () => {
  assert.equal(configuredCareEndpoint('https://care.example.org/', false), 'https://care.example.org');
  const hosts = ['localhost.', 'a.localhost', 'host', 'router.local', 'a.home.arpa', 'a.internal',
    '127.0.0.2', '127.1', '0x7f000001', '10.0.2.2', '172.18.0.1', '192.168.1.2', '169.254.1.1',
    '[::1]', '[::ffff:192.168.1.2]', '[fc00::1]', '[fe80::1]', '8.8.8.8'];
  for (const host of hosts) assert.throws(() => configuredCareEndpoint(`https://${host}`, false), host);
  assert.throws(() => configuredCareEndpoint('http://care.example.org', false));
  assert.throws(() => configuredCareEndpoint('invalid', false));
  assert.equal(configuredCareEndpoint('http://127.0.0.1:8789', true), 'http://127.0.0.1:8789');
  assert.equal(configuredCareEndpoint('http://192.168.1.2:8789', true), 'http://192.168.1.2:8789');
});

test('changing the destination cannot reuse a different server’s saved token', () => {
  const key = 'patient';
  const remote = serviceSessionKey(key, 'https://api.example.org', false);
  assert.equal(serviceSessionKey(key, undefined, true), key);
  assert.notEqual(remote, key);
  assert.equal(serviceSessionKey(key, 'https://API.example.org/', false), remote);
  assert.notEqual(serviceSessionKey(key, 'https://care.example.org', false), remote);
});
