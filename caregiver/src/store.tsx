import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { careRequest, CareApiError } from '../../shared/care-api';
import { downloadSharedPhoto } from '../../shared/care-photo-parts';
import { clearSession, readSession, writeSession } from '../../shared/care-session';
import type { CaregiverData, CaregiverSession } from '../../shared/care-types';
import { isSharedVisit } from '../../shared/care-visit';
import { careClock, isCareTimeZone } from '../../shared/care-clock';
import { localDateKey } from '../../src/domain';
import { makeDemoData } from './demo';
import { OVERDUE_THRESHOLDS, type OverdueThreshold } from './care-status';
import { useOverdueAlerts } from './use-overdue-alerts';
import { ALERT_RECEIPT_KEY } from './device-alert-setting';
import { clearDeliveredAlerts } from './alert-device';
import { CAREGIVER_SESSION_KEY as SESSION_KEY } from './suspend-alerts';

const CACHE_KEY = 'metacare.caregiver.snapshot.v1';
const PREFS_KEY = 'metacare.caregiver.preferences.v1';
type Mode = 'disconnected' | 'connected' | 'demo';
type Session = CaregiverSession & { cacheId: string; caregiverName: string };
export type CarePreferences = { patientNickname: string; phone: string; caregiverName: string; threshold: OverdueThreshold };
const defaults: CarePreferences = { patientNickname: '', phone: '', caregiverName: '', threshold: 30 };
type Cache = { cacheId: string; data: CaregiverData; fetchedAt: string };

function preferences(value: unknown): CarePreferences {
  if (!value || typeof value !== 'object') return { ...defaults };
  const item = value as Partial<CarePreferences>;
  return {
    patientNickname: typeof item.patientNickname === 'string' ? item.patientNickname.slice(0, 30) : '',
    phone: typeof item.phone === 'string' ? item.phone.slice(0, 30) : '',
    caregiverName: typeof item.caregiverName === 'string' ? item.caregiverName.slice(0, 30) : '',
    threshold: OVERDUE_THRESHOLDS.includes(item.threshold as OverdueThreshold) ? item.threshold! : 30,
  };
}

function validData(value: unknown): value is CaregiverData {
  if (!value || typeof value !== 'object') return false;
  const data = value as CaregiverData;
  if (typeof data.connectedAt !== 'string' || typeof data.caregiverName !== 'string') return false;
  if (data.snapshot === null) return true;
  const snapshot = data.snapshot;
  return !!snapshot && typeof snapshot.patientName === 'string' && typeof snapshot.updatedAt === 'string'
    && (snapshot.nextVisit === undefined || isSharedVisit(snapshot.nextVisit))
    && Array.isArray(snapshot.schedule?.times) && Array.isArray(snapshot.doses)
    && snapshot.doses.every(dose => typeof dose.id === 'string' && typeof dose.date === 'string'
      && typeof dose.time === 'string' && typeof dose.label === 'string' && ['pending', 'taken'].includes(dose.status)
      && (!dose.photo || (typeof dose.photo.id === 'string' && typeof dose.photo.capturedAt === 'string')));
}

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof CareApiError) {
    if (error.status === 400 || error.status === 404 || error.status === 410) return '연결 코드를 다시 확인해 주세요. 만료됐다면 환자 휴대폰에서 새 코드를 만들어 주세요.';
    if (error.status === 409) return '이미 사용된 연결 코드예요. 환자 휴대폰에서 새 코드를 만들어 주세요.';
    if (error.status === 429) return '요청이 많아요. 잠시 후 다시 시도해 주세요.';
    if (!error.status || error.status >= 500) return '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
  return fallback;
}

// A visit is shown only from the live response so a withdrawn visit cannot reappear on offline launch.
function medicationCache(data: CaregiverData): CaregiverData {
  if (!data.snapshot?.nextVisit) return data;
  const snapshot = { ...data.snapshot };
  delete snapshot.nextVisit;
  return { ...data, snapshot };
}

type CareContextValue = {
  ready: boolean; mode: Mode; data: CaregiverData | null; prefs: CarePreferences; now: Date;
  alerts: ReturnType<typeof useOverdueAlerts>;
  offerAlerts: boolean; dismissAlertOffer: () => void;
  today: string; medicationClock?: ReturnType<typeof careClock>;
  fetchedAt: string | null; syncing: boolean; busy: boolean; networkError: boolean; error: string | null;
  connect: (code: string) => Promise<boolean>; patientName: string;
  pendingPatient: string | null;
  retryConnectionStorage: () => Promise<boolean>; cancelPendingConnection: () => Promise<boolean>;
  refresh: () => Promise<void>; disconnect: () => Promise<boolean>;
  startDemo: () => void; exitDemo: () => void; savePreferences: (value: CarePreferences) => Promise<boolean>;
  loadPhoto: (id: string) => Promise<string | null>; clearError: () => void;
};
const CareContext = createContext<CareContextValue | null>(null);

export function CaregiverProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [offerAlerts, setOfferAlerts] = useState(false);
  const [mode, setMode] = useState<Mode>('disconnected');
  const [data, setData] = useState<CaregiverData | null>(null);
  const [prefs, setPrefs] = useState<CarePreferences>({ ...defaults });
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingPatient, setPendingPatient] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [networkError, setNetworkError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [demoDate, setDemoDate] = useState(() => localDateKey());
  const sessionRef = useRef<Session | null>(null);
  const pendingSessionRef = useRef<Session | null>(null);
  const modeRef = useRef<Mode>('disconnected');
  const epoch = useRef(0);
  const requestRef = useRef<object | null>(null);
  const mutationRef = useRef(false);
  const storageQueue = useRef<Promise<unknown>>(Promise.resolve());
  const alerts = useOverdueAlerts(activeSession?.token, activeSession?.cacheId);

  // Serialize disk changes as well as guarding network responses. An old write can
  // never restore a token or snapshot after disconnect/revocation.
  const persist = useCallback((operation: () => Promise<unknown>) => {
    const next = storageQueue.current.catch(() => undefined).then(operation);
    storageQueue.current = next.catch(() => undefined);
    return next;
  }, []);

  const clearPrivateState = useCallback(async (notice: string | null = null) => {
    epoch.current += 1;
    clearDeliveredAlerts();
    setOfferAlerts(false);
    const generation = epoch.current;
    sessionRef.current = null;
    setActiveSession(null);
    pendingSessionRef.current = null; setPendingPatient(null);
    modeRef.current = 'disconnected';
    requestRef.current = null;
    mutationRef.current = false;
    setMode('disconnected'); setData(null); setFetchedAt(null); setPrefs({ ...defaults });
    setSyncing(false); setBusy(false); setNetworkError(false); setError(notice);
    await persist(async () => {
      // Always remove the old cache before a later session write in this queue.
      await Promise.all([clearSession(SESSION_KEY), clearSession(ALERT_RECEIPT_KEY), AsyncStorage.multiRemove([CACHE_KEY, PREFS_KEY])]);
    }).catch(() => {
      if (epoch.current === generation) setError('기기에 저장된 연결 정보 삭제를 완료하지 못했어요. 앱을 다시 열어 확인해 주세요.');
    });
  }, [persist]);

  const fetchSnapshot = useCallback(async (session: Session, generation: number) => {
    if (generation !== epoch.current || requestRef.current || mutationRef.current || modeRef.current !== 'connected') return;
    const request = {};
    requestRef.current = request;
    setSyncing(true);
    try {
      const response = await careRequest<CaregiverData>('/v1/caregiver/snapshot', { token: session.token });
      if (epoch.current !== generation || sessionRef.current !== session) return;
      if (!validData(response)) throw new Error('Invalid snapshot');
      const received = new Date().toISOString();
      setData(response); setFetchedAt(received); setNetworkError(false); setError(null); setClock(new Date());
      await persist(async () => {
        if (epoch.current === generation) await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ cacheId: session.cacheId, data: medicationCache(response), fetchedAt: received } satisfies Cache));
      }).catch(() => {
        if (epoch.current === generation) setError('기기에 최근 기록을 저장하지 못했어요. 연결된 동안에는 최신 기록을 볼 수 있어요.');
      });
    } catch (cause) {
      if (epoch.current !== generation || sessionRef.current !== session) return;
      if (cause instanceof CareApiError && (cause.status === 401 || cause.status === 403)) {
        await clearPrivateState('환자와의 연결이 해제됐어요. 다시 연결하려면 새 코드를 받아 주세요.');
      } else {
        setNetworkError(true);
        setError('서버에 연결하지 못했어요. 마지막으로 받은 기록을 표시해요.');
      }
    } finally {
      if (requestRef.current === request) { requestRef.current = null; setSyncing(false); }
    }
  }, [clearPrivateState, persist]);

  const refresh = useCallback(async () => {
    const session = sessionRef.current;
    if (session && modeRef.current === 'connected') await fetchSnapshot(session, epoch.current);
  }, [fetchSnapshot]);

  useEffect(() => {
    let mounted = true;
    const generation = epoch.current;
    void (async () => {
      try {
        const [session, savedCache, savedPreferences] = await Promise.all([
          readSession<Session>(SESSION_KEY), AsyncStorage.getItem(CACHE_KEY), AsyncStorage.getItem(PREFS_KEY),
        ]);
        if (!mounted || generation !== epoch.current) return;
        if (session && typeof session.token === 'string' && session.token.length > 0 && typeof session.cacheId === 'string' && typeof session.patientName === 'string') {
          sessionRef.current = session; modeRef.current = 'connected'; setMode('connected');
          setActiveSession(session);
          try { setPrefs(preferences(savedPreferences ? JSON.parse(savedPreferences) : { caregiverName: session.caregiverName })); } catch { setPrefs({ ...defaults, caregiverName: session.caregiverName || '' }); }
          try {
            const cached = savedCache ? JSON.parse(savedCache) as Cache : null;
            if (cached?.cacheId === session.cacheId && validData(cached.data) && Number.isFinite(Date.parse(cached.fetchedAt))) {
              setData(medicationCache(cached.data)); setFetchedAt(cached.fetchedAt);
            }
          } catch { /* A corrupt cache must not prevent reconnecting. */ }
        } else {
          await persist(() => Promise.all([clearSession(SESSION_KEY), clearSession(ALERT_RECEIPT_KEY), AsyncStorage.multiRemove([CACHE_KEY, PREFS_KEY])]));
        }
      } catch {
        if (mounted) setError('저장된 연결을 불러오지 못했어요. 연결 정보를 다시 입력해 주세요.');
      } finally {
        if (mounted) setReady(true);
      }
    })();
    return () => { mounted = false; };
  }, [persist]);

  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => { setClock(new Date()); void refresh(); };
    const syncActivity = (state: string) => {
      if (timer) clearInterval(timer);
      timer = undefined;
      if (state === 'active') {
        update();
        timer = setInterval(update, 10_000);
      }
    };
    syncActivity(AppState.currentState ?? 'active');
    const subscription = AppState.addEventListener('change', syncActivity);
    return () => { if (timer) clearInterval(timer); subscription.remove(); };
  }, [ready, mode, refresh]);

  const commitConnection = useCallback(async (session: Session, generation: number) => {
    await persist(async () => {
      if (epoch.current !== generation || pendingSessionRef.current !== session) return;
      // A new family's session cannot be saved while an old private cache or
      // contact remains. Retrying uses this exact issued session, never the code.
      await AsyncStorage.multiRemove([CACHE_KEY, PREFS_KEY]);
      await clearSession(ALERT_RECEIPT_KEY);
      await writeSession(SESSION_KEY, session);
    });
    if (epoch.current !== generation || pendingSessionRef.current !== session) return false;
    sessionRef.current = session; pendingSessionRef.current = null; setPendingPatient(null);
    modeRef.current = 'connected'; setMode('connected');
    setActiveSession(session);
    setOfferAlerts(true);
    setPrefs({ ...defaults, caregiverName: session.caregiverName });
    setData(null); setFetchedAt(null); setNetworkError(false); setError(null);
    return true;
  }, [persist]);

  const retryConnectionStorage = useCallback(async () => {
    const session = pendingSessionRef.current;
    if (!session || mutationRef.current) return false;
    const generation = epoch.current;
    mutationRef.current = true; setBusy(true); setError(null);
    try { return await commitConnection(session, generation); }
    catch {
      if (epoch.current === generation) setError('연결 정보를 아직 저장하지 못했어요. 앱을 닫기 전에 다시 시도하거나 연결을 취소해 주세요.');
      return false;
    } finally {
      if (epoch.current === generation) { mutationRef.current = false; setBusy(false); }
    }
  }, [commitConnection]);

  const cancelPendingConnection = useCallback(async () => {
    const session = pendingSessionRef.current;
    if (!session || mutationRef.current) return false;
    mutationRef.current = true; setBusy(true); setError(null);
    const generation = epoch.current;
    try {
      await careRequest('/v1/caregiver/connection', { method: 'DELETE', token: session.token });
      if (epoch.current !== generation) return false;
      await clearPrivateState('연결을 취소했어요. 다시 연결하려면 환자 휴대폰에서 새 코드를 받아 주세요.');
      return true;
    } catch (cause) {
      if (epoch.current !== generation) return false;
      if (cause instanceof CareApiError && (cause.status === 401 || cause.status === 403)) {
        await clearPrivateState('연결이 해제됐어요. 다시 연결하려면 새 코드를 받아 주세요.'); return true;
      }
      // Keep the only received credential until either storage or rollback
      // succeeds. A failed rollback must not return to an empty connect form.
      setError('연결 취소에 실패했어요. 네트워크를 확인하고 다시 시도해 주세요. 계속 실패하면 환자 휴대폰의 내 관리 → 보호자 연결에서 연결을 해제해 주세요.');
      return false;
    } finally {
      if (epoch.current === generation) { mutationRef.current = false; setBusy(false); }
    }
  }, [clearPrivateState]);

  const connect = useCallback(async (rawCode: string) => {
    if (mutationRef.current || pendingSessionRef.current || modeRef.current !== 'disconnected') return false;
    const code = rawCode.replace(/\s/g, '');
    const caregiverName = prefs.caregiverName.trim() || '보호자';
    if (!/^\d{8}$/.test(code)) { setError('8자리 연결 코드를 입력해 주세요.'); return false; }
    mutationRef.current = true; setBusy(true); setError(null);
    const generation = ++epoch.current;
    try {
      const result = await careRequest<CaregiverSession>('/v1/caregivers/connect', { method: 'POST', body: { code, caregiverName } });
      if (epoch.current !== generation) return false;
      if (!result || typeof result.token !== 'string' || !result.token || typeof result.patientName !== 'string') throw new Error('Invalid session');
      const session: Session = { ...result, caregiverName, cacheId: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
      // The invite has already been consumed by the server. Keep its credential
      // before any fallible local storage call, and expose recovery without it.
      pendingSessionRef.current = session; setPendingPatient(session.patientName || '환자');
      setData(null); setFetchedAt(null); setPrefs({ ...defaults });
      return await commitConnection(session, generation);
    } catch (cause) {
      if (epoch.current === generation) setError(pendingSessionRef.current
        ? '환자와는 연결됐지만 이 기기에 연결 정보를 저장하지 못했어요. 앱을 닫기 전에 저장을 다시 시도하거나 연결을 취소해 주세요.'
        : messageFor(cause, '연결하지 못했어요. 코드와 네트워크 연결을 확인한 뒤 다시 시도해 주세요.'));
      return false;
    } finally {
      if (epoch.current === generation) { mutationRef.current = false; setBusy(false); }
    }
  }, [commitConnection, prefs.caregiverName]);

  const disconnect = useCallback(async () => {
    if (modeRef.current === 'demo') { await clearPrivateState(); return true; }
    const session = sessionRef.current;
    if (!session || mutationRef.current) return false;
    mutationRef.current = true; setBusy(true); setError(null);
    const generation = ++epoch.current;
    requestRef.current = null; setSyncing(false);
    try {
      await careRequest('/v1/caregiver/connection', { method: 'DELETE', token: session.token });
      if (epoch.current !== generation) return false;
      await clearPrivateState();
      return true;
    } catch (cause) {
      if (epoch.current !== generation) return false;
      if (cause instanceof CareApiError && (cause.status === 401 || cause.status === 403)) {
        await clearPrivateState(); return true;
      }
      setError('연결을 해제하지 못했어요. 네트워크 연결을 확인하고 다시 시도해 주세요.');
      return false;
    } finally {
      if (epoch.current === generation) { mutationRef.current = false; setBusy(false); }
    }
  }, [clearPrivateState]);

  const startDemo = useCallback(() => {
    if (mutationRef.current || pendingSessionRef.current || modeRef.current !== 'disconnected') return;
    epoch.current += 1;
    const date = localDateKey();
    setDemoDate(date); modeRef.current = 'demo'; setMode('demo'); setData(makeDemoData(date));
    setPrefs({ ...defaults, patientNickname: '엄마', caregiverName: '보호자' });
    setFetchedAt(null); setNetworkError(false); setError(null);
  }, []);

  const exitDemo = useCallback(() => {
    if (modeRef.current !== 'demo') return;
    epoch.current += 1; modeRef.current = 'disconnected'; setMode('disconnected');
    setData(null); setPrefs({ ...defaults }); setFetchedAt(null); setError(null); setNetworkError(false);
  }, []);

  const savePreferences = useCallback(async (value: CarePreferences) => {
    const next = preferences(value);
    if (modeRef.current === 'disconnected') return false;
    if (modeRef.current === 'demo') { setPrefs(next); return true; }
    const generation = epoch.current;
    try {
      await persist(async () => { if (epoch.current === generation) await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next)); });
      if (epoch.current !== generation) return false;
      setPrefs(next); return true;
    } catch { setError('설정을 저장하지 못했어요. 다시 시도해 주세요.'); return false; }
  }, [persist]);

  const photoTransfer = data?.photoTransfer;
  const loadPhoto = useCallback(async (id: string) => {
    const session = sessionRef.current;
    const generation = epoch.current;
    if (!session || modeRef.current !== 'connected') return null;
    try {
      return await downloadSharedPhoto(careRequest, id, session.token, photoTransfer,
        () => generation === epoch.current && sessionRef.current === session);
    } catch (cause) {
      if (generation !== epoch.current) return null;
      if (cause instanceof CareApiError && (cause.status === 401 || cause.status === 403)) {
        await clearPrivateState('환자와의 연결이 해제됐어요. 다시 연결하려면 새 코드를 받아 주세요.');
        return null;
      }
      throw new Error('사진을 불러오지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.');
    }
  }, [clearPrivateState, photoTransfer]);

  const now = mode === 'demo' ? new Date(`${demoDate}T14:20:00`) : clock;
  const timeZone = data?.snapshot?.timeZone;
  const medicationClock = useMemo(() => isCareTimeZone(timeZone) ? careClock(timeZone) : undefined, [timeZone]);
  const today = medicationClock?.wall(now.getTime()).slice(0, 10) ?? localDateKey(now);
  const patientName = data?.snapshot?.patientName.trim() || activeSession?.patientName.trim() || '환자';
  const effectivePrefs = alerts.confirmed?.enabled ? { ...prefs, threshold: alerts.confirmed.threshold } : prefs;
  return <CareContext.Provider value={{ ready, mode, data, prefs: effectivePrefs, alerts, offerAlerts, dismissAlertOffer: () => setOfferAlerts(false), now, today, medicationClock, fetchedAt, syncing, busy, networkError, error, connect, patientName, pendingPatient, retryConnectionStorage, cancelPendingConnection, refresh, disconnect, startDemo, exitDemo, savePreferences, loadPhoto, clearError: () => setError(null) }}>{children}</CareContext.Provider>;
}

export function useCaregiver() {
  const value = useContext(CareContext);
  if (!value) throw new Error('CaregiverProvider is missing');
  return value;
}
