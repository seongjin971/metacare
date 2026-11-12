import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { DevicePushToken } from 'expo-notifications';
import { careRequest, CareApiError } from '../../shared/care-api';
import { clearSession, readSession, writeSession } from '../../shared/care-session';
import { getAlertToken, hasAlertPermission, supportsCareAlerts, watchAlertToken } from './alert-device';
import { OVERDUE_THRESHOLDS, type OverdueThreshold } from './care-status';
import { ALERT_RECEIPT_KEY, reconcileDeviceAlert, type AlertReceipt, type RemoteAlertSetting } from './device-alert-setting';
import { CAREGIVER_SESSION_KEY, serializeAlertWrite } from './suspend-alerts';

const endpoint = '/v1/caregiver/alerts';
const unavailable = '알림 설정을 확인하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';
const conflict = '다른 기기에서 알림 설정이 바뀌었어요. 설정을 다시 확인해 주세요.';
type Confirmed = RemoteAlertSetting & { owns: boolean };

function settings(value: RemoteAlertSetting): RemoteAlertSetting {
  if (typeof value?.enabled !== 'boolean' || !OVERDUE_THRESHOLDS.includes(value.threshold)
      || (value.enabled && (typeof value.registrationId !== 'string' || !value.registrationId))) throw new Error(unavailable);
  return value;
}

export function useOverdueAlerts(token?: string, cacheId?: string) {
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [owner, setOwner] = useState(token);
  if (owner !== token) {
    setOwner(token); setBusy(false); setConfirmed(null); setError(''); setBlocked(false);
  }
  const latest = useRef(token);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const registered = useRef<string | null>(null);
  const serialize = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(operation, operation);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  const put = useCallback((threshold: OverdueThreshold, target: string | null, expectedRegistrationId: string | null) => serializeAlertWrite(async () => {
    if (!token || !cacheId || latest.current !== token) throw new Error('환자 연결을 확인해 주세요.');
    const body = { enabled: !!target, threshold, expectedRegistrationId,
      ...(target && { expoPushToken: target, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) };
    const remote = settings(await careRequest<RemoteAlertSetting>(endpoint, { method: 'PUT', token, body }));
    // Commit the receipt with its server write. A concurrent role change waits for
    // both, so a successful in-flight registration can still be switched off.
    if (latest.current !== token && (await readSession<{ cacheId: string }>(CAREGIVER_SESSION_KEY))?.cacheId !== cacheId)
      throw new Error('환자 연결이 바뀌었어요.');
    if (remote.registrationId && remote.enabled) {
      await writeSession(ALERT_RECEIPT_KEY, { cacheId, registrationId: remote.registrationId } satisfies AlertReceipt);
    } else await clearSession(ALERT_RECEIPT_KEY);
    return remote;
  }), [token, cacheId]);

  const refresh = useCallback((rotated?: DevicePushToken) => serialize(async () => {
    if (!token || !cacheId || latest.current !== token || !supportsCareAlerts) return;
    try {
      const [value, receipt] = await Promise.all([
        careRequest<RemoteAlertSetting>(endpoint, { token }), readSession<AlertReceipt>(ALERT_RECEIPT_KEY),
      ]);
      if (latest.current !== token) return;
      const remote = settings(value);
      const previousTarget = registered.current;
      const result = await reconcileDeviceAlert(remote, cacheId, receipt, () => hasAlertPermission(false), previousTarget,
        () => rotated || !previousTarget ? getAlertToken(rotated) : Promise.resolve(previousTarget),
        (target, expected) => put(remote.threshold, target, expected));
      if (latest.current === token) {
        registered.current = result.target;
        setConfirmed({ ...result.remote, owns: result.owns });
        if (result.blocked || result.owns) setBlocked(result.blocked);
        setError('');
      }
    } catch (cause) {
      if (latest.current === token) {
        setConfirmed(null); setError(cause instanceof CareApiError && cause.status === 409 ? conflict : unavailable);
      }
    }
  }), [put, serialize, token, cacheId]);

  useEffect(() => {
    latest.current = token;
    registered.current = null;
    if (!token || !supportsCareAlerts) return;
    void refresh();
    const activity = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    const rotation = watchAlertToken(rotated => { void refresh(rotated); });
    return () => { latest.current = undefined; activity.remove(); rotation.remove(); };
  }, [token, refresh]);

  const update = useCallback(async (enabled: boolean, threshold: OverdueThreshold) => {
    if (!token || latest.current !== token || !supportsCareAlerts || !confirmed || (!enabled && !confirmed.owns)) return false;
    setBusy(true); setError('');
    let mayHaveSaved = false;
    try {
      if (enabled && !await hasAlertPermission(true)) {
        if (latest.current === token) setBlocked(true);
        return false;
      }
      if (latest.current !== token) return false;
      setBlocked(false);
      const target = enabled ? (confirmed.owns ? registered.current : null) ?? await getAlertToken() : null;
      return await serialize(async () => {
        mayHaveSaved = true;
        const remote = await put(threshold, target, confirmed.registrationId ?? null);
        if (latest.current !== token) return false;
        registered.current = target;
        setConfirmed({ ...remote, owns: remote.enabled });
        return true;
      });
    } catch (cause) {
      if (latest.current === token) {
        if (mayHaveSaved) setConfirmed(null);
        if (cause instanceof CareApiError && cause.status === 409) setError(conflict);
        else if (mayHaveSaved) setError('알림 설정을 저장했는지 확인하지 못했어요. 다시 확인해 주세요.');
        else setError(cause instanceof Error ? cause.message : unavailable);
      }
      return false;
    } finally {
      if (latest.current === token) setBusy(false);
    }
  }, [token, confirmed, put, serialize]);

  return { confirmed: confirmed && { enabled: confirmed.owns, threshold: confirmed.threshold },
    otherDevice: confirmed?.enabled && !confirmed.owns, blocked, busy, error, refresh, update };
}
