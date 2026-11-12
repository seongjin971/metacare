import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileDeviceAlert, type RemoteAlertSetting } from '../caregiver/src/device-alert-setting.ts';

const active: RemoteAlertSetting = { enabled: true, threshold: 30, registrationId: 'current-device' };
const owned = { cacheId: 'this-family', registrationId: 'current-device' };
const forbidden = async (): Promise<never> => { throw new Error('Another device must not inspect permissions or change the subscription.'); };

test('opening the family on another browser or with a stale receipt cannot replace or disable registered alerts', async () => {
  for (const receipt of [null, { ...owned, cacheId: 'previous-family' }, { ...owned, registrationId: 'superseded' }]) {
    const result = await reconcileDeviceAlert(active, 'this-family', receipt, forbidden, null, forbidden, forbidden);
    assert.deepEqual(result, { remote: active, target: null, blocked: false, owns: false });
  }
});

test('revoking notification permission disables only the specific registration the device owns', async () => {
  const disabled: RemoteAlertSetting = { enabled: false, threshold: 30 };
  const result = await reconcileDeviceAlert(active, 'this-family', owned, async () => false, null, forbidden, async (target, id) => {
    assert.equal(target, null);
    assert.equal(id, active.registrationId);
    return disabled;
  });
  assert.deepEqual(result, { remote: disabled, target: null, blocked: true, owns: false });
});

test('token rotation can renew the owned target, while an unchanged target performs no write', async () => {
  const getTarget = async () => 'new-target';
  const renewed: RemoteAlertSetting = { ...active, registrationId: 'renewed-device' };
  const result = await reconcileDeviceAlert(active, 'this-family', owned, async () => true, 'old-target', getTarget, async (target, id) => {
    assert.equal(target, 'new-target');
    assert.equal(id, active.registrationId);
    return renewed;
  });
  assert.deepEqual(result, { remote: renewed, target: 'new-target', blocked: false, owns: true });
  const same = await reconcileDeviceAlert(renewed, 'this-family', { ...owned, registrationId: 'renewed-device' },
    async () => true, 'new-target', getTarget, forbidden);
  assert.deepEqual(same, result);
});
