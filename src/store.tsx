import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState as NativeAppState, Modal, Platform, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, createInitialState, ensureDailyDoses, validateLoadedState } from './domain';
import { NotificationSyncResult, syncReminders } from './notifications';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FadeIn, MotionPressable as Pressable, useReducedMotion } from './motion';
import { PatientSharingProvider } from './caregiver-link';
import { mergeNewerVisitData, onWebVisitDataChanged, writeWebState } from './web-visit-storage';
import { createSamplePatientState } from './sample-patient-state';
import { restoreSampleMedication, SAMPLE_MEDICATION_KEY, serializeSampleMedication, withSampleMedicationHistory } from './sample-medication-storage';

const STORAGE_KEY = 'metacare.demo.v1';
export type Dialog = {
  title: string; body: string; label: string; cancelLabel?: string; destructive?: boolean; onConfirm: () => void;
};
type Store = { sample: boolean; state: AppState; update: (change: (s: AppState) => AppState, message?: string) => boolean; commit: (change: (s: AppState) => AppState, message?: string) => Promise<boolean>; notify: (message: string) => void; confirm: (dialog: Dialog) => void; notificationStatus: NotificationSyncResult; setNotificationStatus: (v: NotificationSyncResult) => void; now: Date };
const Context = createContext<Store | null>(null);
export function useCare() { const value = useContext(Context); if (!value) throw new Error('CareProvider required'); return value; }

export function SampleCareProvider({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== 'web') return <CareProvider sample>{children}</CareProvider>;
  return <WebSampleCareProvider>{children}</WebSampleCareProvider>;
}

function WebSampleCareProvider({ children }: { children: React.ReactNode }) {
  const [now] = useState(() => new Date());
  const [state, setState] = useState(() => createSamplePatientState(now));
  const current = useRef(state);
  const [message, setMessage] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<NotificationSyncResult>({ status: 'disabled', message: '', count: 0 });
  const update = useCallback<Store['update']>((change, success) => {
    try {
      const next = change(current.current);
      current.current = next;
      setState(next);
      if (success) setMessage(success);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '처리하지 못했습니다. 다시 시도해 주세요.');
      return false;
    }
  }, []);
  const commit = useCallback<Store['commit']>(async (change, success) => update(change, success), [update]);
  return <Context.Provider value={{ sample: true, state, update, commit, notify: setMessage, confirm: setDialog, notificationStatus, setNotificationStatus, now }}>
    {children}
    <CareFeedback message={message} setMessage={setMessage} dialog={dialog} setDialog={setDialog} />
  </Context.Provider>;
}

export function CareProvider({ children, sample = false }: { children: React.ReactNode; sample?: boolean }) {
  const [state, setState] = useState<AppState>(() => createInitialState());
  // Sharing observes successful disk writes, never optimistic UI changes.
  const [durableState, setDurableState] = useState<AppState | null>(null);
  const current = useRef(state);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [message, setMessage] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [now, setNow] = useState(new Date());
  const [notificationStatus, setNotificationStatus] = useState<NotificationSyncResult>({ status: 'disabled', message: '알림 설정을 확인해 주세요.', count: 0 });
  const queue = useRef(Promise.resolve());
  const committing = useRef(false);
  const replacingUnreadable = useRef(false);
  const syncSequence = useRef(0);
  const notify = useCallback((value: string) => setMessage(value), []);
  const writeState = useCallback(async (base: AppState, change?: (state: AppState) => AppState) => {
    if (Platform.OS === 'web') {
      const saved = await writeWebState(STORAGE_KEY, base, change, replacingUnreadable.current);
      replacingUnreadable.current = false;
      return saved;
    }
    const next = change ? change(base) : base;
    if (sample) await AsyncStorage.setItem(SAMPLE_MEDICATION_KEY, serializeSampleMedication(next));
    else await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }, [sample]);
  const receiveVisitData = useCallback((saved: AppState) => {
    const next = mergeNewerVisitData(current.current, saved);
    if (next !== current.current) { current.current = next; setState(next); }
    setDurableState(previous => previous ? mergeNewerVisitData(previous, saved) : previous);
  }, []);
  useEffect(() => {
    if (Platform.OS === 'web') return onWebVisitDataChanged(STORAGE_KEY, receiveVisitData);
  }, [receiveVisitData]);
  const persist = useCallback((next: AppState) => {
    queue.current = queue.current.then(async () => {
      try {
        const saved = await writeState(next);
        if (Platform.OS === 'web') receiveVisitData(saved);
        setDurableState(previous => previous ? mergeNewerVisitData(saved, previous) : saved);
        setSaveError('');
      }
      catch { setSaveError('기기에 저장하지 못했습니다. 앱을 닫으면 변경 내용이 사라질 수 있습니다.'); }
    });
  }, [receiveVisitData, writeState]);
  const update = useCallback((change: (s: AppState) => AppState, success?: string) => {
    if (committing.current) { setMessage('저장 중이에요. 잠시 기다려 주세요.'); return false; }
    try {
      const next = change(current.current); current.current = next; setState(next); persist(next);
      if (success) setMessage(success);
      return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : '처리하지 못했습니다. 다시 시도해 주세요.'); return false; }
  }, [persist]);
  // Report success only after the new record is durable. Keep concurrent writes in order.
  const commit = useCallback((change: (s: AppState) => AppState, success?: string): Promise<boolean> => {
    if (committing.current) return Promise.resolve(false);
    committing.current = true;
    const result = queue.current.then(async () => {
      try {
        const saved = await writeState(current.current, change);
        const next = mergeNewerVisitData(saved, current.current);
        current.current = next;
        setState(next);
        setDurableState(next);
        setSaveError('');
        if (success) setMessage(success);
        return true;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '저장하지 못했어요. 다시 시도해 주세요.');
        return false;
      } finally { committing.current = false; }
    });
    queue.current = result.then(() => undefined);
    return result;
  }, [writeState]);
  const setCaregiverSharing = useCallback(async (active: boolean) => {
    await queue.current;
    if (current.current.sharing.caregiver === active) return true;
    return commit(value => ({ ...value, sharing: { ...value.sharing, caregiver: active } }));
  }, [commit]);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(sample ? SAMPLE_MEDICATION_KEY : STORAGE_KEY).then(raw => {
      if (!alive) return;
      const next = sample ? restoreSampleMedication(raw) : ensureDailyDoses(raw ? validateLoadedState(JSON.parse(raw)) : createInitialState());
      current.current = next; setState(next); setLoaded(true); persist(next);
    }).catch(() => { if (alive) setLoadError('이 기기에 저장된 기록을 불러올 수 없어요. 새 기록을 저장하면 기존 기록을 대체해요.'); });
    return () => { alive = false; };
  }, [persist, sample]);
  useEffect(() => {
    if (!loaded) return;
    const refresh = () => { const time = new Date(); setNow(time); const next = ensureDailyDoses(current.current, time); if (next !== current.current) update(() => next); };
    const timer = setInterval(refresh, 30000);
    const subscription = NativeAppState.addEventListener('change', status => { if (status === 'active') refresh(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [loaded, update]);
  useEffect(() => {
    if (!loaded || sample) return;
    const sequence = ++syncSequence.current;
    syncReminders(state).then(result => { if (syncSequence.current === sequence) setNotificationStatus(result); }).catch(() => { if (syncSequence.current === sequence) setNotificationStatus({ status: 'error', message: '알림 등록을 확인하지 못했습니다. 내 관리에서 다시 확인해 주세요.', count: 0 }); });
  }, [state, loaded, now, sample]);
  const displayState = useMemo(() => sample ? withSampleMedicationHistory(state, now) : state, [sample, state, now]);
  if (!loaded) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, backgroundColor: '#f5f7fb', gap: 18 }}>{loadError ? <><Text style={{ fontSize: 16, lineHeight: 25 }}>{loadError}</Text><Pressable accessibilityRole="button" onPress={() => { replacingUnreadable.current = true; const next = createInitialState(); current.current = next; setState(next); setLoadError(''); setLoaded(true); setSaveError('다음 저장 시 이 기기의 기존 기록이 새 기록으로 대체돼요.'); }}><Text style={{ color: '#3066e9', fontWeight: '700' }}>새 기록으로 시작</Text></Pressable></> : <><ActivityIndicator color="#3066e9" /><Text>메타케어를 준비하고 있어요</Text></>}</View>;
  return <Context.Provider value={{ sample, state: displayState, update, commit, notify, confirm: setDialog, notificationStatus, setNotificationStatus, now }}>
    {saveError ? <View style={{ backgroundColor: '#fff0d3', padding: 12 }}><Text accessibilityRole="alert">{saveError}</Text></View> : null}
    {sample ? children : <PatientSharingProvider durableState={durableState} onActiveChange={setCaregiverSharing}>{children}</PatientSharingProvider>}
    <CareFeedback message={message} setMessage={setMessage} dialog={dialog} setDialog={setDialog} />
  </Context.Provider>;
}

function CareFeedback({ message, setMessage, dialog, setDialog }: {
  message: string; setMessage: (value: string) => void; dialog: Dialog | null; setDialog: (value: Dialog | null) => void;
}) {
  const reducedMotion = useReducedMotion();
  const inset = useSafeAreaInsets();
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 4200); return () => clearTimeout(timer); }, [message, setMessage]);
  return <>
    {message ? <FadeIn motionKey={message} style={{ position: 'absolute', top: inset.top + 12, left: 20, right: 20, alignSelf: 'center', zIndex: 20, maxWidth: 650 }}>
      <Pressable accessibilityRole="alert" onPress={() => setMessage('')} style={{ backgroundColor: '#172b4d', borderRadius: 16, padding: 17 }}>
        <Text style={{ color: 'white', lineHeight: 23, fontSize: 14 }}>{message}</Text>
      </Pressable>
    </FadeIn> : null}
    <Modal visible={!!dialog} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={() => setDialog(null)}>
      <View style={{ flex: 1, backgroundColor: '#14213b66', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <FadeIn accessibilityViewIsModal style={{ width: '100%', maxWidth: 430, backgroundColor: 'white', padding: 26, borderRadius: 26, gap: 18 }}>
          <Text accessibilityRole="header" style={{ fontSize: 21, fontWeight: '700', color: '#172b4d' }}>{dialog?.title}</Text>
          <Text style={{ fontSize: 15, lineHeight: 24, color: '#59677e' }}>{dialog?.body}</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable accessibilityRole="button" onPress={() => setDialog(null)} style={{ flex: 1, padding: 16, borderRadius: 14, backgroundColor: '#f0f3f9' }}>
              <Text style={{ textAlign: 'center', fontWeight: '700', color: '#192c4b' }}>{dialog?.cancelLabel ?? '취소'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => { const action = dialog?.onConfirm; setDialog(null); action?.(); }} style={{ flex: 1, padding: 16, borderRadius: 14, backgroundColor: dialog?.destructive ? '#ab403b' : '#3066e9' }}>
              <Text style={{ textAlign: 'center', color: 'white', fontWeight: '700' }}>{dialog?.label}</Text>
            </Pressable>
          </View>
        </FadeIn>
      </View>
    </Modal>
  </>;
}
