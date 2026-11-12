import { careRequest, CareApiError } from '../../shared/care-api';
import { clearSession, readSession } from '../../shared/care-session';
import type { CaregiverSession } from '../../shared/care-types';
import { clearDeliveredAlerts } from './alert-device';
import { ALERT_RECEIPT_KEY, type AlertReceipt, type RemoteAlertSetting } from './device-alert-setting';

export const CAREGIVER_SESSION_KEY = 'metacare.caregiver.session.v1';
let writes: Promise<unknown> = Promise.resolve();

export function serializeAlertWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = writes.then(operation);
  writes = next.catch(() => undefined);
  return next;
}

/** Switching roles stops delivery to this installation but keeps its family pairing. */
export function suspendOwnCaregiverAlerts(): Promise<void> {
  return serializeAlertWrite(async () => {
    const [receipt, session] = await Promise.all([
      readSession<AlertReceipt>(ALERT_RECEIPT_KEY),
      readSession<CaregiverSession & { cacheId: string }>(CAREGIVER_SESSION_KEY),
    ]);
    if (session && receipt?.cacheId === session.cacheId && receipt.registrationId) {
      const path = '/v1/caregiver/alerts';
      try {
        const remote = await careRequest<RemoteAlertSetting>(path, { token: session.token });
        if (remote.enabled && remote.registrationId === receipt.registrationId) {
          await careRequest(path, { method: 'PUT', token: session.token,
            body: { enabled: false, threshold: remote.threshold, expectedRegistrationId: receipt.registrationId } });
        }
      } catch (error) {
        // 401 means the pairing was revoked. 409 means the recipient was already changed.
        if (!(error instanceof CareApiError) || (error.status !== 401 && error.status !== 409))
          throw new Error('이 기기의 보호자 알림을 끄려면 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
      }
      await clearSession(ALERT_RECEIPT_KEY);
    }
    clearDeliveredAlerts();
  });
}
