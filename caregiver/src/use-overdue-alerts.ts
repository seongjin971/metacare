import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { DevicePushToken } from 'expo-notifications';
import { careRequest } from '../../shared/care-api';
import { getAlertToken, hasAlertPermission, supportsCareAlerts, watchAlertToken } from './alert-device';
import { OVERDUE_THRESHOLDS, type OverdueThreshold } from './care-status';

type AlertSettings = { enabled: boolean; threshold: OverdueThreshold };
const endpoint = '/v1/caregiver/alerts';
const unavailable = '알림 설정을 확인하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';

function settings(value: AlertSettings): AlertSettings {
  if (typeof value?.enabled !== 'boolean' || !OVERDUE_THRESHOLDS.includes(value.threshold)) throw new Error(unavailable);
  return value;
}

export function useOverdueAlerts(token?: string) {
  const [confirmed, setConfirmed] = useState<AlertSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [owner, setOwner] = useState(token);
  if (owner !== token) {
    setOwner(token); setBusy(false); setConfirmed(null); setError('');
  }
  const latest = useRef(token);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const registered = useRef<string | null>(null);
  const serialize = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(operation, operation);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  const put = useCallback(async (enabled: boolean, threshold: OverdueThreshold, expoPushToken?: string) => {
    if (!token || latest.current !== token) throw new Error('환자 연결을 확인해 주세요.');
    const body = {
      enabled, threshold,
      ...(expoPushToken && { expoPushToken, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    };
    const response = await careRequest<AlertSettings>(endpoint, { method: 'PUT', token, body });
    return settings(response);
  }, [token]);

  const refresh = useCallback((rotated?: DevicePushToken) => serialize(async () => {
    if (!token || latest.current !== token || !supportsCareAlerts) return;
    try {
      let remote = settings(await careRequest<AlertSettings>(endpoint, { token }));
      if (latest.current !== token) return;
      if (remote.enabled) {
        if (!await hasAlertPermission(false)) {
          remote = await put(false, remote.threshold);
          registered.current = null;
        } else if (!registered.current || rotated) {
          const currentToken = await getAlertToken(rotated);
          if (currentToken !== registered.current) remote = await put(true, remote.threshold, currentToken);
          if (latest.current !== token) return;
          registered.current = currentToken;
        }
      } else {
        registered.current = null;
      }
      if (latest.current === token) { setConfirmed(remote); setError(''); }
    } catch {
      if (latest.current === token) { setConfirmed(null); setError(unavailable); }
    }
  }), [put, serialize, token]);

  useEffect(() => {
    latest.current = token;
    registered.current = null;
    if (!token || !supportsCareAlerts) return;
    void refresh();
    const activity = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    const rotation = watchAlertToken(rotated => { void refresh(rotated); });
    return () => { latest.current = undefined; activity.remove(); rotation.remove(); };
  }, [token, refresh]);

  const update = useCallback((enabled: boolean, threshold: OverdueThreshold) => serialize(async () => {
    if (!token || latest.current !== token || !supportsCareAlerts) return false;
    setBusy(true); setError('');
    let mayHaveSaved = false;
    try {
      let expoPushToken: string | undefined;
      if (enabled) {
        if (!await hasAlertPermission(true)) throw new Error('휴대폰 설정에서 보호자 앱의 복약 미기록 알림을 허용해 주세요.');
        expoPushToken = registered.current ?? await getAlertToken();
      }
      mayHaveSaved = true;
      const remote = await put(enabled, threshold, expoPushToken);
      if (latest.current !== token) return false;
      registered.current = expoPushToken ?? null;
      setConfirmed(remote); return true;
    } catch (cause) {
      if (latest.current === token) {
        if (mayHaveSaved) setConfirmed(null);
        setError(mayHaveSaved ? '알림 설정을 저장했는지 확인하지 못했어요. 다시 확인해 주세요.'
          : cause instanceof Error ? cause.message : unavailable);
      }
      return false;
    } finally {
      if (latest.current === token) setBusy(false);
    }
  }), [token, put, serialize]);

  return { confirmed, busy, error, refresh, update };
}
