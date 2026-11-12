import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, StyleSheet, Text, View } from 'react-native';
import type { SharedDose } from '../../shared/care-types';
import { Card, Icon, Page, s, type IconName } from '../../src/ui';
import { MotionPressable as Pressable, useReducedMotion } from '../../src/motion';
import { getDoseState, isSnapshotStale } from './care-status';
import { relativeTime } from '../../src/relative-time';
import { useCaregiver } from './store';

export const colors = { ink: '#183044', teal: '#16766F', soft: '#EDF6F4', amber: '#9A6225', amberSoft: '#FCF4E8', line: '#E4EBEE', muted: '#71808B' };

export function CareButton({ title, onPress, disabled = false, secondary = false, icon, danger = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; icon?: IconName; danger?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, { backgroundColor: disabled ? '#E8EDF0' : secondary ? colors.soft : danger ? '#A5433B' : colors.teal, opacity: pressed ? 0.85 : 1 }]}>
    {icon && <Icon name={icon} size={18} color={secondary ? colors.teal : 'white'} />}
    <Text style={{ fontSize: 15, fontWeight: '600', color: disabled ? colors.muted : secondary ? colors.teal : 'white' }}>{title}</Text>
  </Pressable>;
}

export function CarePage({ title, children }: { title: string; children: React.ReactNode }) {
  const { mode, exitDemo } = useCaregiver();
  return <Page title={title} keyboardDismissMode="on-drag">
    <View style={{ maxWidth: 680, width: '100%', alignSelf: 'center', gap: 20 }}>
      {mode === 'demo' && <View style={styles.connectionRow}>
        <Text style={[s.micro, { flex: 1 }]}>환자 미연결</Text>
        <Pressable accessibilityRole="button" onPress={exitDemo} style={styles.textButton}><Text style={{ color: colors.teal, fontWeight: '600', fontSize: 13 }}>환자 연결하기</Text></Pressable>
      </View>}
      {children}
    </View>
  </Page>;
}

export function shortTimestamp(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return '아직 없음';
  const time = new Date(value);
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(time);
}

export function SyncStatus() {
  const { mode, data, now, fetchedAt, networkError, syncing, refresh, error } = useCaregiver();
  if (mode === 'demo') return null;
  const updatedAt = data?.snapshot?.updatedAt;
  const stale = isSnapshotStale(updatedAt, fetchedAt, now);
  const updated = relativeTime(updatedAt, now);
  // The screen refreshes on its own; a retry button appears only when that is failing.
  return <View style={{ gap: 8 }}>
    <Text accessibilityLiveRegion="polite" style={[s.micro, (networkError || stale) && { color: colors.amber }]}>{
      networkError ? '인터넷에 연결되지 않아 마지막으로 받은 기록을 보여드려요.'
        : !fetchedAt ? '기록을 불러오는 중이에요.'
        : stale ? `${updated ?? '한동안'} 이후 환자 휴대폰에서 새 기록이 오지 않았어요.`
        : updated ? `${updated} 업데이트` : '아직 받은 기록이 없어요.'}</Text>
    {networkError && <Pressable accessibilityRole="button" accessibilityLabel="다시 시도" accessibilityState={{ disabled: syncing }} disabled={syncing} onPress={() => void refresh()} style={styles.refresh}>
      {syncing ? <ActivityIndicator size="small" color={colors.teal} /> : <Icon name="refresh-outline" color={colors.teal} size={18} />}
      <Text style={{ color: colors.teal, fontSize: 13, fontWeight: '600' }}>{syncing ? '확인 중' : '다시 시도'}</Text>
    </Pressable>}
    {error && !networkError && <Text accessibilityRole="alert" style={[s.micro, { color: colors.amber }]}>{error}</Text>}
  </View>;
}

const stateLabels = { recorded: '기록됨', overdue: '미기록', waiting: '기록 대기', scheduled: '예정', unknown: '일정 확인 필요' };
export function DoseRow({ dose, onPhoto }: { dose: SharedDose; onPhoto: (dose: SharedDose) => void }) {
  const { prefs, now, medicationClock } = useCaregiver();
  const state = getDoseState(dose, prefs.threshold, now, medicationClock);
  const color = state === 'recorded' ? colors.teal : state === 'overdue' ? colors.amber : colors.muted;
  return <View style={styles.doseRow}>
    <Text style={styles.doseTime}>{dose.time}</Text>
    <View style={{ flex: 1, gap: 5 }}>
      <Text style={s.section}>{dose.label}</Text>
      <Text style={[s.micro, { color }]}>{stateLabels[state]}{state === 'recorded' && dose.takenAt ? ` · ${shortTimestamp(dose.takenAt)}` : ''}</Text>
    </View>
    {dose.photo && state === 'recorded' ? <Pressable accessibilityRole="button" accessibilityLabel={`${dose.time} ${dose.label} 사진 보기`} onPress={() => onPhoto(dose)} style={styles.photoButton}>
      <Icon name="image-outline" size={20} color={colors.teal} /><Text style={styles.photoLabel}>사진</Text>
    </Pressable> : <Icon name={state === 'recorded' ? 'checkmark-circle-outline' : state === 'overdue' ? 'alert-circle-outline' : 'time-outline'} size={21} color={color} />}
  </View>;
}

export function DoseList({ doses, onPhoto }: { doses: SharedDose[]; onPhoto: (dose: SharedDose) => void }) {
  return <Card style={{ paddingVertical: 0, gap: 0 }}>
    {doses.map((dose, index) => <React.Fragment key={dose.id}>{index > 0 && <View style={s.divider} />}<DoseRow dose={dose} onPhoto={onPhoto} /></React.Fragment>)}
  </Card>;
}

export function PhotoViewer({ dose, onClose }: { dose: SharedDose | null; onClose: () => void }) {
  const { mode, data } = useCaregiver();
  const current = dose?.photo && data?.snapshot?.doses.find(item =>
    item.id === dose.id && item.status === 'taken' && item.photo?.id === dose.photo?.id);
  useEffect(() => {
    if (dose && !current) onClose();
  }, [dose, current, onClose]);
  if (!current?.photo || mode !== 'connected') return null;
  return <SharedPhotoViewer key={`${mode}:${current.photo.id}`} dose={current} onClose={onClose} />;
}

function SharedPhotoViewer({ dose, onClose }: { dose: SharedDose; onClose: () => void }) {
  const { loadPhoto, mode } = useCaregiver();
  const reducedMotion = useReducedMotion();
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(mode === 'connected');
  const [attempt, setAttempt] = useState(0);
  const photoId = dose?.photo?.id;
  useEffect(() => {
    let active = true;
    if (!photoId || mode !== 'connected') return () => { active = false; };
    void loadPhoto(photoId).then(result => {
      if (!active) return;
      setUri(result);
      if (!result) setError('사진을 볼 수 없어요. 연결 상태를 확인해 주세요.');
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '사진을 불러오지 못했어요.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [photoId, loadPhoto, mode, attempt]);

  // Nothing is written to disk. The image is discarded on close or revocation.
  return <Modal visible={!!dose && mode !== 'disconnected'} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={onClose}>
    <View style={styles.modalBackdrop}>
      <View accessibilityViewIsModal style={styles.modalCard}>
        <View style={s.row}><Text accessibilityRole="header" style={s.section}>{dose?.label} · 공유 사진</Text><Pressable accessibilityRole="button" accessibilityLabel="사진 닫기" onPress={onClose} style={styles.close}><Icon name="close" color={colors.ink} size={23} /></Pressable></View>
        <Text style={s.micro}>촬영 {shortTimestamp(dose?.photo?.capturedAt)}</Text>
        {loading ? <View style={styles.photoArea}><ActivityIndicator size="large" color={colors.teal} /><Text style={s.body}>사진을 불러오는 중이에요.</Text></View>
          : uri ? <Image source={{ uri }} resizeMode="contain" accessibilityLabel={`${dose?.label} 기록에 첨부된 사진`} style={styles.photoArea} />
            : <View style={[styles.photoArea, { padding: 20 }]}><Text accessibilityRole="alert" style={s.body}>{error}</Text><CareButton secondary title="다시 불러오기" onPress={() => { setLoading(true); setError(null); setUri(null); setAttempt(value => value + 1); }} /></View>}
        <Text style={s.micro}>사진과 기록만으로 실제 복용 여부를 확인할 수는 없어요.</Text>
      </View>
    </View>
  </Modal>;
}

export const styles = StyleSheet.create({
  button: { minHeight: 48, borderRadius: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  textButton: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  connectionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  refresh: { minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  doseRow: { paddingVertical: 16, minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 14 },
  doseTime: { color: colors.ink, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'], width: 48 },
  photoButton: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 3 },
  photoLabel: { fontSize: 11, color: colors.teal },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 30, 42, 0.5)', padding: 20, alignItems: 'center', justifyContent: 'center' },
  modalCard: { width: '100%', maxWidth: 560, backgroundColor: 'white', padding: 20, borderRadius: 16, gap: 12 },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  photoArea: { width: '100%', height: 280, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: '#F2F5F6', borderRadius: 10 },
});
