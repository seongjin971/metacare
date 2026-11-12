import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState as NativeAppState, Platform, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { careRequest, CareApiError } from '../shared/care-api';
import { clearSession, readSession, writeSession } from '../shared/care-session';
import type { PatientConnection as Connection, PatientSnapshotUpdate, PhotoTransfer } from '../shared/care-types';
import { PhotoTooLargeError, uploadSharedPhoto } from '../shared/care-photo-parts';
import { MAX_SHARED_VISITS } from '../shared/care-visit';
import type { AppState } from './domain';
import { makeCareSnapshot } from './caregiver-snapshot';
import { completePatientRevocation, readPatientSharingSession, reconcileVisitConsent, requestPatientRevocation, type PatientSharingSession } from './caregiver-session';
import { readPhotoForSharing } from './caregiver-photo-upload';
import { Button, C, Card, Icon, s } from './ui';
import { MotionPressable as Pressable } from './motion';
import { relativeTime } from './relative-time';

const SESSION_KEY = 'metacare.patient-sharing.v1';
type Invitation = { code: string; expiresAt: string };
type PatientSession = PatientSharingSession;
type Sharing = {
  ready: boolean; busy: boolean; stopping: boolean; session: PatientSession | null; connection: Connection | null;
  error: string; photosPending: boolean; clock: number; patientName: string;
  invite: () => Promise<void>; disconnect: () => Promise<void>; retry: () => Promise<void>;
  setVisitSharing: (enabled: boolean) => Promise<void>;
};
const SharingContext = createContext<Sharing | null>(null);

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '인터넷에 연결되지 않았어요. 연결을 확인한 뒤 다시 시도해 주세요.';
}

export function PatientSharingProvider({ durableState, onActiveChange, children }: {
  durableState: AppState | null; onActiveChange: (active: boolean) => Promise<boolean>; children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [session, setSession] = useState<PatientSession | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState('');
  const [photosPending, setPhotosPending] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const saved = useRef<PatientSession | null>(null);
  const durable = useRef(durableState);
  const foreground = useRef(NativeAppState.currentState === 'active');
  const alive = useRef(true);
  const working = useRef(false);
  const revoking = useRef(false);
  const idle = useRef(Promise.resolve());
  const generation = useRef(0);
  const uploaded = useRef(new Set<string>());
  // Older builds stored photos above the sharing limit. The caregiver sees the record without the photo.
  const unshareable = useRef(new Set<string>());
  const published = useRef('');
  const publishedAt = useRef(0);

  const startOperation = useCallback(() => {
    working.current = true;
    let finish = () => {};
    idle.current = new Promise<void>(resolve => { finish = resolve; });
    return finish;
  }, []);

  const save = useCallback(async (next: PatientSession, epoch = generation.current) => {
    if (!alive.current || generation.current !== epoch) return;
    await writeSession(SESSION_KEY, next);
    if (!alive.current || generation.current !== epoch) return;
    saved.current = next;
    setSession(next);
  }, []);

  const handleFailure = useCallback(async (caught: unknown) => {
    if (!alive.current) return;
    if (caught instanceof CareApiError && caught.status === 401) {
      // An explicitly rejected token cannot revoke or publish anything. Require fresh consent.
      ++generation.current;
      saved.current = null;
      setSession(null);
      setConnection(null);
      setPhotosPending(false);
      uploaded.current.clear();
      published.current = '';
      try { await clearSession(SESSION_KEY); } catch { /* The rejected token still cannot authorize an upload on restart. */ }
      await onActiveChange(false);
      setError('연결 인증이 만료되었거나 해제됐어요. 공유 동의 후 보호자를 다시 연결해 주세요.');
    } else setError(errorText(caught));
  }, [onActiveChange]);

  useEffect(() => {
    alive.current = true;
    readSession<unknown>(SESSION_KEY).then(raw => {
      if (!alive.current) return;
      const next = readPatientSharingSession(raw);
      saved.current = next;
      setSession(next);
      setReady(true);
    }).catch(() => {
      if (alive.current) setError('보호자 연결 정보를 불러오지 못했어요. 앱을 다시 열어 주세요.');
    });
    return () => { alive.current = false; generation.current += 1; };
  }, []);

  const publish = useCallback(async (current: PatientSession, epoch: number, connectedAt: string | null, photoTransfer?: PhotoTransfer) => {
    const state = durable.current;
    if (!state) throw new Error('복약 기록을 기기에 저장 중이에요. 잠시 뒤 다시 시도해 주세요.');
    const valid = () => alive.current && generation.current === epoch && saved.current?.active === true
      && saved.current.token === current.token;
    if (!valid()) return;
    const pref = current.visitPreference?.connectedAt === connectedAt ? current.visitPreference : undefined;
    const snapshot = makeCareSnapshot(state, state.profile?.name ?? current.patientName, new Date(), pref?.enabled === true, pref?.scope);
    const body: PatientSnapshotUpdate = pref ? { ...snapshot, visitUpdate: {
      connectedAt: pref.connectedAt, enabled: pref.enabled, consentRevision: pref.revision,
      ...(pref.enabled && pref.scope && { scope: pref.scope }),
      scheduleRevision: pref.enabled ? state.visitsRevision : 0,
    } } : snapshot;
    const serialized = JSON.stringify(body);
    if (pref?.pending || published.current !== serialized || Date.now() - publishedAt.current >= 60000) {
      const result = await careRequest<{ updatedAt: string }>('/v1/patient/snapshot', { method: 'PUT', token: current.token, body });
      if (!valid()) return;
      await save({ ...saved.current!, lastSync: result.updatedAt, ...(pref?.pending ? { visitPreference: { ...pref, pending: false } } : {}) }, epoch);
      if (!valid()) return;
      published.current = serialized;
      publishedAt.current = Date.now();
    }
    if (!connectedAt || !valid()) return;
    const references = new Set(snapshot.doses.flatMap(dose => dose.photo ? [dose.photo.id] : []));
    uploaded.current = new Set([...uploaded.current].filter(id => references.has(id)));
    let failed = false;
    for (const id of references) {
      if (!valid() || !foreground.current) return;
      if (durable.current !== state) { setPhotosPending(true); return; }
      if (uploaded.current.has(id) || unshareable.current.has(id)) continue;
      const photo = state.doses.find(dose => dose.photo?.id === id)?.photo;
      if (!photo) continue;
      try {
        const dataUri = await readPhotoForSharing(photo);
        const complete = await uploadSharedPhoto(careRequest, id, current.token, dataUri, photoTransfer,
          () => valid() && foreground.current && durable.current === state);
        if (!complete) return;
        uploaded.current.add(id);
      } catch (caught) {
        if (caught instanceof CareApiError && caught.status === 401) throw caught;
        if (caught instanceof PhotoTooLargeError) { unshareable.current.add(id); continue; }
        failed = true;
        if (caught instanceof CareApiError && caught.status !== 400) break;
      }
    }
    if (valid()) setPhotosPending(failed);
  }, [save]);

  const revokePending = useCallback(async (current: PatientSession, epoch: number) => {
    await careRequest('/v1/patient/connection', { method: 'DELETE', token: current.token });
    if (!alive.current || generation.current !== epoch) return;
    const next = completePatientRevocation(current);
    saved.current = next;
    setSession(next);
    setConnection(null);
    setPhotosPending(false);
    published.current = '';
    uploaded.current.clear();
    await onActiveChange(false);
    await save(next, epoch);
    setError('');
  }, [save, onActiveChange]);

  const refresh = useCallback(async () => {
    const current = saved.current;
    if (!ready || !current || (!current.active && !current.pendingRevoke) || working.current || revoking.current || !foreground.current) return;
    const finish = startOperation();
    setBusy(true);
    const epoch = generation.current;
    try {
      if (current.pendingRevoke) { await revokePending(current, epoch); return; }
      const next = await careRequest<Connection>('/v1/patient/connection', { token: current.token });
      if (!alive.current || generation.current !== epoch) return;
      setConnection(next);
      if (!next.caregiverName && current.wasConnected) {
        const ended = completePatientRevocation(current);
        saved.current = ended;
        setSession(ended);
        setPhotosPending(false);
        uploaded.current.clear();
        published.current = '';
        await save(ended, epoch);
        await onActiveChange(false);
        setError('보호자가 연결을 해제했어요. 다시 공유하려면 새로 연결해 주세요.');
        return;
      }
      // Neither an old local sharing toggle nor an unused/expired invite authorizes ongoing upload.
      if (next.caregiverName && next.connectedAt && foreground.current) {
        const paired = reconcileVisitConsent(current.wasConnected ? current : { ...current, wasConnected: true }, next.connectedAt, next.visitConsent);
        if (paired !== current) await save(paired, epoch);
        await publish(paired, epoch, next.connectedAt, next.photoTransfer);
        if (generation.current === epoch) await onActiveChange(true);
      }
      if (alive.current && generation.current === epoch) setError('');
    } catch (caught) {
      if (alive.current && generation.current === epoch) await handleFailure(caught);
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
      finish();
    }
  }, [ready, publish, save, onActiveChange, startOperation, handleFailure, revokePending]);

  useEffect(() => {
    if (!ready) return;
    foreground.current = NativeAppState.currentState === 'active';
    void refresh();
    const timer = setInterval(() => { setClock(Date.now()); void refresh(); }, 10000);
    const subscription = NativeAppState.addEventListener('change', status => {
      foreground.current = status === 'active';
      if (status === 'active') { setClock(Date.now()); void refresh(); }
    });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [ready, refresh]);

  useEffect(() => { durable.current = durableState; void refresh(); }, [durableState, refresh]);

  const setVisitSharing = useCallback(async (enabled: boolean) => {
    const current = saved.current;
    if (!current?.active || !current.wasConnected || working.current || revoking.current) return;
    const connectedAt = connection?.connectedAt ?? current.visitPreference?.connectedAt;
    if (!connectedAt) return;
    const finish = startOperation();
    setBusy(true);
    try {
      const revision = Math.max(Date.now(), (current.visitPreference?.revision ?? 0) + 1);
      await save({ ...current, visitPreference: {
        enabled, connectedAt, revision, pending: true, ...(enabled && { scope: 'upcoming' }),
      } });
    } catch (caught) {
      setError(errorText(caught));
      return;
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
      finish();
    }
    await refresh();
  }, [connection, refresh, save, startOperation]);

  const invite = useCallback(async () => {
    if (!ready || working.current || revoking.current || saved.current?.pendingRevoke) return;
    if (!durable.current) { setError('복약 기록을 기기에 저장 중이에요. 잠시 뒤 다시 시도해 주세요.'); return; }
    const finish = startOperation();
    setBusy(true);
    setError('');
    const epoch = ++generation.current;
    try {
      let current = saved.current;
      let existing = current ? await careRequest<Connection>('/v1/patient/connection', { token: current.token }) : null;
      if (!alive.current || generation.current !== epoch) return;
      if (!current || existing?.sharingRevoked) {
        // This is the only identity creation path, reached by the explicit consent button.
        const created = await careRequest<{ token: string }>('/v1/patients', { method: 'POST', body: {} });
        if (!alive.current || generation.current !== epoch) return;
        current = { token: created.token, patientName: current?.patientName ?? '환자', consentVersion: 1, active: false };
        await save(current, epoch);
        existing = { caregiverName: null, connectedAt: null };
      }
      if (!alive.current || generation.current !== epoch || !existing) return;
      if (existing.caregiverName && existing.connectedAt) {
        setConnection(existing);
        current = reconcileVisitConsent({ ...current, active: true, wasConnected: true }, existing.connectedAt, existing.visitConsent);
        await save(current, epoch);
        await publish(current, epoch, existing.connectedAt, existing.photoTransfer);
        if (generation.current === epoch) await onActiveChange(true);
        return;
      }
      current = { token: current.token, patientName: current.patientName, consentVersion: 1, active: true };
      await save(current, epoch);
      published.current = '';
      await publish(current, epoch, null);
      if (!alive.current || generation.current !== epoch) return;
      const nextInvite = await careRequest<Invitation>('/v1/patient/invite', { method: 'POST', token: current.token, body: {} });
      if (!alive.current || generation.current !== epoch) return;
      await save({ ...saved.current!, invite: nextInvite }, epoch);
      if (!alive.current || generation.current !== epoch) return;
      setConnection(existing);
      setClock(Date.now());
    } catch (caught) {
      if (alive.current && generation.current === epoch) await handleFailure(caught);
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
      finish();
    }
  }, [ready, save, publish, startOperation, handleFailure, onActiveChange]);

  const disconnect = useCallback(async () => {
    const current = saved.current;
    if (!current || revoking.current) return;
    revoking.current = true;
    setStopping(true);
    const epoch = ++generation.current;
    const pending = requestPatientRevocation(current);
    saved.current = pending;
    setSession(pending);
    // Stop queued photo work immediately, then revoke after the one in-flight request settles.
    await idle.current;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      // Persist withdrawal before remote cleanup; a failed DELETE must never resume publishing.
      await save(pending, epoch);
      await revokePending(pending, epoch);
    } catch (caught) {
      if (alive.current) await handleFailure(caught);
    } finally {
      working.current = false;
      revoking.current = false;
      if (alive.current) { setBusy(false); setStopping(false); }
    }
  }, [save, handleFailure, revokePending]);

  return <SharingContext.Provider value={{ ready, busy, stopping, session, connection, error, photosPending, clock, patientName: durableState?.profile?.name ?? session?.patientName ?? '환자', invite, disconnect, setVisitSharing, retry: refresh }}>{children}</SharingContext.Provider>;
}

function InviteCodeHandoff({ invite, expiresIn }: { invite: Invitation; expiresIn: number }) {
  const [feedback, setFeedback] = useState('');
  const web = Platform.OS === 'web';
  const canHandoff = !web || (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function');
  const handoff = async () => {
    if (Date.parse(invite.expiresAt) <= Date.now()) { setFeedback('코드가 만료됐어요. 새 코드를 만들어 주세요.'); return; }
    setFeedback('');
    try {
      if (web) {
        await navigator.clipboard.writeText(invite.code);
        setFeedback('연결 코드를 복사했어요.');
      } else {
        await Share.share({ message: `메타케어에서 ‘보호자예요’를 선택하고 연결 코드 ${invite.code}를 입력해 주세요.` });
      }
    } catch { setFeedback('코드 8자리를 보호자에게 직접 알려주세요.'); }
  };
  return <>
    <Text selectable accessibilityLabel={`연결 코드 ${invite.code.split('').join(' ')}`} style={styles.code}>{invite.code.slice(0, 4)} {invite.code.slice(4)}</Text>
    <Text style={s.muted}>{Math.floor(expiresIn / 60)}분 {expiresIn % 60}초 남음 · 한 번만 사용할 수 있어요.</Text>
    <Text style={s.body}>연결할 보호자에게만 알려주세요. 보호자가 자기 기기에 코드를 입력하면 여기에 이름이 표시돼요.</Text>
    {canHandoff && <Button title={web ? '코드 복사' : '보호자에게 코드 전달'} icon={web ? 'copy-outline' : 'share-outline'} onPress={() => void handoff()} />}
    {!!feedback && <Text accessibilityLiveRegion="polite" style={s.muted}>{feedback}</Text>}
  </>;
}

export function CaregiverLinkCard({ confirm, onEditName }: {
  confirm: (dialog: { title: string; body: string; label: string; cancelLabel?: string; destructive?: boolean; onConfirm: () => void }) => void;
  onEditName?: () => void;
}) {
  const sharing = useContext(SharingContext);
  if (!sharing) throw new Error('PatientSharingProvider required');
  const { ready, busy, stopping, session, connection, error, photosPending, clock, patientName, invite, disconnect, setVisitSharing, retry } = sharing;
  const connected = session?.active === true && !!connection?.caregiverName && !!connection.connectedAt;
  const established = connected || session?.wasConnected === true;
  const nextOnly = session?.visitPreference?.enabled === true && session.visitPreference.scope !== 'upcoming';
  const visitControlDisabled = busy || stopping || (!connection?.connectedAt && !session?.visitPreference);
  const waiting = session?.active === true;
  const expiresIn = session?.invite ? Math.max(0, Math.floor((Date.parse(session.invite.expiresAt) - clock) / 1000)) : 0;
  const stop = () => confirm({
    title: established ? '보호자 연결을 해제할까요?' : '보호자 초대를 취소할까요?',
    body: '보호자는 더 이상 내 기록을 볼 수 없고, 공유했던 기록과 사진도 지워져요. 이 휴대폰에 있는 내 기록은 그대로 남아요.',
    label: established ? '연결 해제' : '초대 취소',
    cancelLabel: established ? '연결 유지' : '초대 유지',
    destructive: true,
    onConfirm: () => void disconnect(),
  });
  return <Card>
    <Text style={s.section}>보호자 연결</Text>
    {!ready && !error && <Text style={s.muted}>연결 정보를 확인하고 있어요.</Text>}
    {ready && !session?.pendingRevoke && <View style={styles.profiles}>
      <View style={styles.action}>
        <Text style={s.micro}>내 프로필</Text>
        <View style={styles.nameRow}>
          <Text style={[styles.profileName, { flexShrink: 1 }]}>{patientName}</Text>
          {onEditName && <Pressable accessibilityRole="button" accessibilityLabel="내 이름 변경" onPress={onEditName} hitSlop={8} style={styles.nameEdit}>
            <Text style={styles.nameEditText}>변경</Text>
          </Pressable>}
        </View>
      </View>
      <Icon name="link-outline" size={18} color={connected ? C.green : C.muted} />
      <View style={styles.action}>
        <Text style={s.micro}>{connected ? '연결된 보호자' : '보호자 프로필'}</Text>
        {connected ? <Text style={styles.profileName}>{connection.caregiverName}</Text>
          : <Text style={s.muted}>{waiting && session.wasConnected ? '연결 확인 중' : '연결하면 표시돼요'}</Text>}
      </View>
    </View>}
    {session?.pendingRevoke ? <>
      <Text style={styles.warning}>공유를 멈췄어요 · 연결 해제를 마무리하는 중이에요</Text>
      <Text style={s.body}>새 기록과 사진은 더 이상 보내지 않아요. 인터넷에 연결되면 보호자의 접근 권한과 공유했던 기록을 지워요.</Text>
      <Button title={busy || stopping ? '연결 해제 중…' : '연결 해제 다시 시도'} secondary disabled={busy || stopping} onPress={() => void retry()} />
    </> : connected ? <>
      <Text style={s.body}>보호자와 복약 일정, 기록, 약봉투 사진을 공유하고 있어요.</Text>
      <Text style={s.muted}>{session.lastSync ? `${relativeTime(session.lastSync, clock)} 보호자에게 전달됐어요` : '보호자에게 전달하는 중이에요'}</Text>
      {photosPending && <Text style={styles.warning}>사진 일부를 아직 보내지 못했어요. 앱을 열어 두면 다시 보내요.</Text>}
      {!!error && <Button title={busy ? '다시 보내는 중…' : '다시 시도'} secondary small disabled={busy} onPress={() => void retry()} />}
      <Button title={stopping ? '해제 중…' : '연결 해제'} secondary small disabled={stopping} onPress={stop} />
    </> : waiting ? <>
      {session.wasConnected ? <Text style={s.body}>보호자 연결 상태를 확인하고 있어요.</Text>
        : session.invite && expiresIn > 0 ? <InviteCodeHandoff key={session.invite.code} invite={session.invite} expiresIn={expiresIn} />
        : <>
          <Text style={s.body}>{session.invite ? '연결 코드가 만료됐어요.' : busy ? '연결 코드를 만드는 중이에요.' : '아직 사용할 수 있는 연결 코드가 없어요.'}</Text>
          {(!busy || session.invite) && <Button title={busy ? '코드 만드는 중…' : '새 연결 코드 만들기'} disabled={busy} onPress={() => void invite()} />}
        </>}
      {(session.wasConnected || (error && session.invite && expiresIn > 0)) && <Button title="연결 상태 다시 확인" secondary small disabled={busy} onPress={() => void retry()} />}
      <Button title={established ? '연결 해제' : '초대 취소'} secondary small disabled={stopping} onPress={stop} />
    </> : <SharingConsentForm key={session?.token ?? 'new'} ready={ready} busy={busy || stopping} invite={invite} />}
    {session?.active && session.wasConnected && !session.pendingRevoke && <>
      <View style={styles.consent}>
        <View style={styles.action}>
          <Text style={s.body}>진료 일정 공유</Text>
          <Text style={s.muted}>{nextOnly ? '가장 가까운 진료 한 건의 병원명·날짜·시간을 공유하고 있어요.'
            : `예정된 진료 최대 ${MAX_SHARED_VISITS}건의 병원명·날짜·시간을 보호자에게 보여줘요.`}</Text>
        </View>
        <Switch accessibilityLabel="보호자에게 진료 일정 공유" value={session.visitPreference?.enabled === true}
          onValueChange={enabled => void setVisitSharing(enabled)} disabled={visitControlDisabled}
          trackColor={{ false: '#dfe5ee', true: C.blue }} thumbColor="white" />
      </View>
      {nextOnly && <Button title={`예정된 진료 최대 ${MAX_SHARED_VISITS}건 공유하기`} small secondary
        disabled={visitControlDisabled} onPress={() => void setVisitSharing(true)} />}
      {session.visitPreference?.pending && <Text style={s.muted}>{session.visitPreference.enabled ? '보호자에게 전달하는 중이에요' : '인터넷에 연결되면 보호자 화면에서 일정이 사라져요.'}</Text>}
    </>}
    {error ? <Text accessibilityRole="alert" style={styles.warning}>{error}</Text> : null}
  </Card>;
}

function SharingConsentForm({ ready, busy, invite }: { ready: boolean; busy: boolean; invite: () => Promise<void> }) {
  // This form remounts after disconnect or rejected credentials, so consent is never preselected.
  const [consented, setConsented] = useState(false);
  return <>
    <Text style={s.body}>보호자와 연결하면 내 복약 기록을 함께 확인할 수 있어요.</Text>
    <Text style={s.muted}>이름·복약 일정·최근 90일 복용 여부와 기록 시간·최근 약봉투 사진 최대 30장을 서버와 연결한 보호자에게 공유합니다. 연결 코드를 만들 때 기록을 먼저 전송하며, 앱을 사용하는 동안 새 기록을 동기화합니다. 언제든 연결을 해제할 수 있어요.</Text>
    <View style={styles.consent}>
      <Text style={[s.body, styles.action]}>위 정보의 공유에 동의합니다</Text>
      <Switch accessibilityLabel="보호자 정보 공유에 동의" value={consented} onValueChange={setConsented} disabled={!ready || busy} trackColor={{ false: '#dfe5ee', true: C.blue }} thumbColor="white" />
    </View>
    <Button title={busy ? '코드 만드는 중…' : '연결 코드 만들기'} disabled={!ready || busy || !consented} onPress={() => void invite()} />
  </>;
}

const styles = StyleSheet.create({
  profiles: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 9, backgroundColor: C.bg },
  profileName: { color: C.navy, fontSize: 15, fontWeight: '600', lineHeight: 22 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameEdit: { minHeight: 32, justifyContent: 'center' },
  nameEditText: { color: C.blue, fontSize: 13, fontWeight: '600' },
  code: { color: C.navy, fontSize: 30, fontWeight: '700', letterSpacing: 3, textAlign: 'center', paddingVertical: 12 },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  action: { flex: 1 },
  consent: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  warning: { color: '#a66b1d', fontSize: 13, lineHeight: 20 },
});
