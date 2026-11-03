import type { OverdueThreshold } from './care-status';

export type RemoteAlertSetting = { enabled: boolean; threshold: OverdueThreshold; registrationId?: string };
export type AlertReceipt = { cacheId: string; registrationId: string };
export const ALERT_RECEIPT_KEY = 'metacare.caregiver.alert-receipt.v1';

// A paired browser can read the family's setting, but only a device that enabled
// alerts may renew or cancel that registration without an explicit user action.
export async function reconcileDeviceAlert(
  remote: RemoteAlertSetting, cacheId: string, receipt: AlertReceipt | null,
  hasPermission: () => Promise<boolean>, previousTarget: string | null, resolveTarget: () => Promise<string>,
  renew: (target: string | null, expectedId: string) => Promise<RemoteAlertSetting>,
) {
  if (!remote.enabled || !remote.registrationId || receipt?.cacheId !== cacheId || receipt.registrationId !== remote.registrationId)
    return { remote, target: null, blocked: false, owns: false };
  if (!await hasPermission())
    return { remote: await renew(null, remote.registrationId), target: null, blocked: true, owns: false };
  const target = await resolveTarget();
  const setting = target === previousTarget ? remote : await renew(target, remote.registrationId);
  return { remote: setting, target, blocked: false, owns: true };
}
