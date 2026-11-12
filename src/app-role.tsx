import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RoleActions, type AppRole } from './role-actions';
import { RolePicker } from './role-picker';
import { setForegroundNotificationRole } from './foreground-notifications';
import { suspendPatientReminders } from './notifications';
import { suspendOwnCaregiverAlerts } from '../caregiver/src/suspend-alerts';
import { Button, C, s } from './ui';

const ROLE_KEY = 'metacare.role.v1';
const asRole = (v: string | null): AppRole | null => v === 'patient' || v === 'caregiver' ? v : null;
const Context = createContext<{ role: AppRole | null; choose: (role: AppRole) => void; busy: AppRole | null; error: string } | null>(null);
export function useAppRole() { const ctx = useContext(Context); if (!ctx) throw new Error('RoleProvider required'); return ctx; }

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<AppRole | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [busy, setBusy] = useState<AppRole | null>(null);
  const [error, setError] = useState('');
  const saving = useRef(false);
  useEffect(() => {
    let alive = true;
    let updated = false;
    const accept = (value: string | null) => {
      const selected = asRole(value);
      setForegroundNotificationRole(selected);
      setRole(selected); setReady(true); setLoadError(false); setSwitching(false); setError('');
    };
    function onStorage(event: StorageEvent) {
      if (event.storageArea === window.localStorage && (event.key === ROLE_KEY || event.key === null)) {
        updated = true; accept(event.newValue);
      }
    }
    if (Platform.OS === 'web') window.addEventListener('storage', onStorage);
    AsyncStorage.getItem(ROLE_KEY).then(value => { if (alive && !updated) accept(value); })
      .catch(() => { if (alive && !updated) setLoadError(true); });
    return () => { alive = false; if (Platform.OS === 'web') window.removeEventListener('storage', onStorage); };
  }, [retry]);
  const choose = useCallback(async (next: AppRole) => {
    if (saving.current) return;
    if (next === role) { setSwitching(false); return; }
    saving.current = true; setBusy(next); setError('');
    try {
      // When upgrading, the previous apps had no role preference. Retain their records
      // and pairing, but do not leave reminders running for a role the device is leaving.
      // A device leaving the caregiver role stops receiving that family's overdue alerts.
      if (next === 'patient') await suspendOwnCaregiverAlerts();
      else if (role === 'patient' || await AsyncStorage.getItem('metacare.demo.v1') !== null) await suspendPatientReminders();
      await AsyncStorage.setItem(ROLE_KEY, next);
      setForegroundNotificationRole(next);
      setRole(next); setSwitching(false);
    } catch (cause) {
      setError(cause instanceof Error && /[가-힣]/.test(cause.message) ? cause.message : '역할을 저장하지 못했어요. 다시 시도해 주세요.');
    } finally { saving.current = false; setBusy(null); }
  }, [role]);
  const cancel = useCallback(() => { if (!saving.current) { setSwitching(false); setError(''); } }, []);
  const changeRole = useCallback(() => { setError(''); setSwitching(true); }, []);
  if (!ready) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, padding: 24, backgroundColor: C.bg }}>
    {loadError ? <><Text accessibilityRole="alert" style={s.body}>이 기기의 역할을 불러오지 못했어요.</Text>
      <Button title="다시 시도" onPress={() => { setLoadError(false); setRetry(n => n + 1); }} /></> : <ActivityIndicator color={C.blue} />}
  </View>;
  return <Context.Provider value={{ role, choose, error, busy }}><RoleActions.Provider value={{ changeRole }}>
    {children}
    {switching && role && <Modal visible onRequestClose={cancel} animationType="none">
      <RolePicker current={role} choosing={busy} error={error} onSelect={choose} onCancel={cancel} />
    </Modal>}
  </RoleActions.Provider></Context.Provider>;
}
