import React, { useCallback, useState } from 'react';
import { Modal, Platform, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Dose, localDateKey, MAX_PATIENT_NAME, recordDose, setMedicationSchedule, setPatientName, setReminderOffsets, startedOn } from './domain';
import { shiftMonth, startOfMonth } from './calendar';
import { MonthCalendar } from './month-calendar';
import { dosesForHistoryDate, summarizeDosesByDate } from './medication-history';
import { MedicationHistoryCard } from './medication-history-card';
import { useCare } from './store';
import { Button, C, Card, Icon, Page, s } from './ui';
import { requestReminderPermission } from './notifications';
import { formatReminderOffset, ReminderKind } from './reminder-settings';
import { ReminderTimePicker } from './reminder-time-picker';
import { medicationScheduleLabel } from './medication-schedule';
import { MedicationSchedulePicker } from './medication-schedule-picker';
import { formatClockTime } from './clock-time';
import { DoseCamera } from './dose-camera';
import { isPhotoAnalyzerAvailable, type VerifiedDoseCapture } from './verify-dose-photo';
import { DosePhotoButton } from './dose-photo-button';
import { removeDosePhoto, saveDosePhoto } from './dose-photo-storage';
import { savePhotoRecord } from './save-photo-record';
import { FadeIn, MotionPressable as Pressable, useReducedMotion } from './motion';
import { doseTiming, lateText, nextDose } from './dose-timing';
import { CaregiverLinkCard } from './caregiver-link';
import { HospitalContactCard } from './hospital-contact-card';
import { useRoleActions } from './role-actions';

const AMBER = '#a66b1d';

function TextAction({ label, onPress, accessibilityLabel }: { label: string; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} style={styles.textAction}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

/** The only way to record a dose: photograph its pouch. Owns the camera for that dose. */
function CaptureButton({ dose, large = false }: { dose: Dose; large?: boolean }) {
  const { commit } = useCare();
  const [cameraOpen, setCameraOpen] = useState(false);
  useFocusEffect(useCallback(() => () => setCameraOpen(false), []));
  const saveCapture = async (capture: VerifiedDoseCapture, canCommit: () => boolean) => {
    return savePhotoRecord(capture, {
      savePhoto: saveDosePhoto,
      removePhoto: removeDosePhoto,
      canCommit,
      commitRecord: photo => commit(state => {
        if (!canCommit()) throw new Error('촬영이 중단됐어요. 다시 촬영해 주세요.');
        const current = state.doses.find(item => item.id === dose.id);
        if (!current || current.status !== 'pending') throw new Error('복약 일정이 변경됐어요. 복약 화면에서 다시 확인해 주세요.');
        return recordDose(state, dose.id, true, new Date(), photo);
      }, '사진 인증 완료'),
    });
  };
  return <>
    {large ? <Button title="약봉투 촬영하고 기록하기" icon="camera-outline" onPress={() => setCameraOpen(true)} />
      : <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${dose.label} 약봉투 촬영`}
        onPress={() => setCameraOpen(true)}
        style={({ pressed }) => [styles.captureButton, pressed && { opacity: 0.7 }]}
      >
        <Icon name="camera-outline" size={18} color={C.blue} />
        <Text style={styles.captureLabel}>약봉투 촬영</Text>
      </Pressable>}
    {cameraOpen && <DoseCamera label={dose.label} onClose={() => setCameraOpen(false)} onSave={saveCapture} />}
  </>;
}

function DoseRow({ dose, canCapture, overdueBy }: { dose: Dose; canCapture: boolean; overdueBy?: number }) {
  const { commit, confirm, notify } = useCare();
  const taken = dose.status === 'taken';
  const recordedTime = dose.takenAt
    ? new Date(dose.takenAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
  const recordLabel = dose.photo?.verification ? '사진 인증' : dose.photo ? '사진 기록' : '자가 기록';
  const recordDetail = `${recordLabel} ${recordedTime}`.trimEnd();
  const undo = () => confirm({
    title: '복약 기록을 취소할까요?',
    body: `${dose.label} 기록을 미기록으로 바꿉니다.${dose.photo ? ' 이 기록에 첨부한 사진도 삭제돼요.' : ''}`,
    label: '기록 취소',
    cancelLabel: '기록 유지',
    destructive: true,
    onConfirm: () => {
      void commit(state => recordDose(state, dose.id, false), '기록을 취소했어요.').then(async saved => {
        if (saved && dose.photo) await removeDosePhoto(dose.photo).catch(() => notify('기록은 취소했지만 사진 파일 정리에 실패했어요.'));
      });
    },
  });
  return (
    <View style={styles.doseRow}>
      <View style={styles.itemContent}>
        <Text style={styles.itemTitle}>{dose.label}</Text>
        <Text style={s.muted}>{dose.time}
          {taken && <Text style={{ color: C.green }}> · {recordDetail}</Text>}
          {!taken && overdueBy !== undefined && <Text style={{ color: AMBER }}> · {lateText(overdueBy)}</Text>}
        </Text>
      </View>
      {!taken && canCapture ? <CaptureButton dose={dose} />
        : taken ? (
          <View style={s.inline}>
            {dose.photo && <DosePhotoButton photo={dose.photo} label={dose.label} />}
            <Pressable accessibilityRole="button" accessibilityLabel={`${dose.label} 기록 취소`} onPress={undo} style={styles.recordAction}>
              <Text style={s.muted}>기록 취소</Text>
            </Pressable>
          </View>
        ) : <Text style={[s.muted, overdueBy !== undefined && { color: AMBER }]}>미기록</Text>}
    </View>
  );
}

/** Today's single next action, so a missed or due dose is the first thing the patient sees. */
function NextDoseCard({ doses, now, firstDay }: { doses: Dose[]; now: Date; firstDay: boolean }) {
  const { state: care } = useCare();
  const canCapture = isPhotoAnalyzerAvailable();
  if (!doses.length) {
    if (!firstDay) return null;
    const first = care.medicationSchedule.times[0];
    return <Card>
      <Text style={s.micro}>다음 복약</Text>
      <Text style={styles.nextTitle}>내일 {formatClockTime(first)}부터 기록해요</Text>
      <Text style={s.muted}>오늘 복약 시간은 설정 전에 모두 지났어요. 내일부터 시간마다 약봉투를 촬영해 주세요.</Text>
    </Card>;
  }
  const next = nextDose(doses, now);
  if (!next) return <Card style={{ backgroundColor: C.mint, borderColor: '#cdeee4' }}>
    <View style={s.inline}><Icon name="checkmark-circle" size={26} color={C.green} /><Text style={[s.section, { color: C.green }]}>오늘 약을 모두 드셨어요</Text></View>
  </Card>;
  const { dose, state, minutesLate } = next;
  const status = state === 'overdue' ? `${dose.time} · ${lateText(minutesLate)}` : state === 'due' ? `${dose.time} · 지금 드실 시간이에요` : `${dose.time}에 드세요`;
  return <Card style={state === 'overdue' ? { borderColor: '#f1d3a6', backgroundColor: '#fff8ec' } : undefined}>
    <Text style={s.micro}>{state === 'upcoming' ? '다음 복약' : '지금 할 일'}</Text>
    <View style={{ gap: 4 }}>
      <Text style={styles.nextTitle}>{dose.label}</Text>
      <View style={s.inline}>
        {state === 'overdue' && <Icon name="alert-circle-outline" size={18} color={AMBER} />}
        <Text style={[styles.nextStatus, state === 'overdue' && { color: AMBER }]}>{status}</Text>
      </View>
    </View>
    {canCapture ? <CaptureButton dose={dose} large />
      : <Text style={s.muted}>약봉투 촬영은 메타케어 설치 앱에서 할 수 있어요.</Text>}
  </Card>;
}

function DoseList({ doses, now }: { doses: Dose[]; now: Date }) {
  const canCapture = isPhotoAnalyzerAvailable();
  return (
    <View>
      {doses.map((dose, index) => {
        const timing = doseTiming(dose, now);
        return <React.Fragment key={dose.id}>
          {index > 0 && <View style={s.divider} />}
          <DoseRow dose={dose} canCapture={canCapture} overdueBy={dose.status === 'pending' && timing.state === 'overdue' ? timing.minutesLate : undefined} />
        </React.Fragment>;
      })}
    </View>
  );
}

export function MedicationScreen() {
  const { state, now, sample } = useCare();
  const today = localDateKey(now);
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(() => startOfMonth(today));
  // Return to today's actions on tab entry and when the local day rolls over.
  const goToToday = useCallback(() => {
    setDate(today);
    setMonth(startOfMonth(today));
  }, [today]);
  useFocusEffect(goToToday);
  const changeMonth = (amount: number) => {
    const next = shiftMonth(month, amount);
    setMonth(next);
    setDate(next === startOfMonth(today) ? today : next);
  };
  const doses = dosesForHistoryDate(state.doses, date, today);
  const done = doses.filter(dose => dose.status === 'taken').length;
  const summaries = summarizeDosesByDate(state.doses, today);
  const firstDay = startedOn(state, today);
  return (
    <Page title="복약">
      <View style={styles.stack}>
        {date === today && <NextDoseCard doses={doses} now={now} firstDay={firstDay} />}
        {date === today && doses.length > 0 ? <Card>
          <View style={s.inline}>
            <Text style={s.section}>오늘 복약</Text>
            <Text style={[s.muted, done === doses.length && { color: C.green }]}>{done}/{doses.length}</Text>
          </View>
          {firstDay && doses.length < state.medicationSchedule.times.length
            && <Text style={s.micro}>설정 전에 지난 복약 시간은 빼고, 오늘은 {doses[0].label}부터 기록해요.</Text>}
          <DoseList doses={doses} now={now} />
        </Card> : date === today ? (firstDay ? null : <Card><Text style={s.muted}>복약 일정이 없어요.</Text></Card>) : <>
          <Button title="오늘로 돌아가기" icon="arrow-back" secondary small onPress={goToToday} />
          <MedicationHistoryCard key={date} doses={doses} sample={sample} emptyMessage={date > today ? '아직 복약 기록이 없어요.' : '복약 기록이 없어요.'} />
        </>}
        <Text style={[s.section, { marginTop: 4 }]}>지난 기록 보기</Text>
        <MonthCalendar
          compact
          month={month}
          selectedDate={date}
          today={today}
          onSelectDate={setDate}
          onChangeMonth={changeMonth}
          onToday={goToToday}
          getDayInfo={day => {
            const summary = summaries.get(day);
            return summary ? {
              accessibilityLabel: `복약 ${summary.total}회 중 ${summary.taken}회 기록`,
              markers: [{ text: `${summary.taken}/${summary.total}`, color: summary.taken === summary.total ? C.green : C.muted }],
            } : {};
          }}
        />
      </View>
    </Page>
  );
}

function ReminderRow({ title, values, enabled, busy, onEdit, onToggle }: {
  title: string; values: number[]; enabled: boolean; busy: boolean;
  onEdit: () => void; onToggle: (enabled: boolean) => void;
}) {
  return (
    <View style={styles.settingRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${title} 알림 시간 설정`} accessibilityState={{ disabled: busy }} disabled={busy} onPress={onEdit} style={[styles.itemContent, styles.reminderDetails]}>
        <Text style={styles.itemTitle}>{title}</Text>
        <View style={s.inline}>
          <Text style={[s.muted, { color: C.blue, flexShrink: 1 }]}>{values.map(formatReminderOffset).join(' · ')}</Text>
          <Icon name="chevron-forward" size={14} color={C.blue} />
        </View>
      </Pressable>
      <Switch accessibilityLabel={`${title} 알림`} disabled={busy} value={enabled} onValueChange={onToggle} trackColor={{ false: '#dfe5ee', true: C.blue }} thumbColor="white" />
    </View>
  );
}

export function SettingsScreen() {
  const { state, update, now, sample } = useCare();
  const [editingMedication, setEditingMedication] = useState(false);
  const hasRecordedToday = state.doses.some(dose => dose.date === localDateKey(now) && dose.status === 'taken');
  return (
    <Page title="내 관리">
      <View style={styles.stack}>
        <Card>
          <Pressable accessibilityRole="button" accessibilityLabel="복약 설정" onPress={() => setEditingMedication(true)} style={[s.row, { minHeight: 56, gap: 16 }]}>
            <View style={styles.itemContent}>
              <Text style={s.section}>복약 설정</Text>
              <Text style={s.body}>{medicationScheduleLabel(state.medicationSchedule)}</Text>
              <Text style={s.muted}>{state.medicationSchedule.times.map(formatClockTime).join(' · ')}</Text>
            </View>
            <Icon name="chevron-forward" size={18} color={C.muted} />
          </Pressable>
        </Card>
        <HospitalContactCard editable />
        {!sample && <SharingAndReminderSettings />}
      </View>
      {editingMedication && <MedicationSchedulePicker
        value={state.medicationSchedule}
        appliesTomorrow={hasRecordedToday}
        onClose={() => setEditingMedication(false)}
        onSave={schedule => {
          const time = sample ? now : new Date();
          const appliesTomorrow = state.doses.some(dose => dose.date === localDateKey(time) && dose.status === 'taken');
          if (update(current => setMedicationSchedule(current, schedule, time), appliesTomorrow ? '저장했어요. 내일부터 적용됩니다.' : '복약 일정을 저장했어요.')) setEditingMedication(false);
        }}
      />}
    </Page>
  );
}

/** The name is only shown to the caregiver, so it is edited from the caregiver connection card. */
function NameEditor({ onClose }: { onClose: () => void }) {
  const { state, update } = useCare();
  const reducedMotion = useReducedMotion();
  const inset = useSafeAreaInsets();
  const [draft, setDraft] = useState(state.profile?.name ?? '');
  const save = () => { if (update(current => setPatientName(current, draft), '이름을 저장했어요.')) onClose(); };
  return <Modal visible transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={onClose}>
    <View style={[styles.backdrop, { paddingTop: Math.max(16, inset.top), paddingBottom: Math.max(16, inset.bottom) }]}>
      <FadeIn accessibilityViewIsModal accessibilityLabel="이름 변경" style={styles.sheet}>
        <Text accessibilityRole="header" style={s.section}>이름 변경</Text>
        <TextInput accessibilityLabel="내 이름" value={draft} onChangeText={setDraft} maxLength={MAX_PATIENT_NAME} autoFocus
          returnKeyType="done" onSubmitEditing={save} style={s.input} />
        <Text style={s.micro}>보호자 화면에 이 이름으로 표시돼요.</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Button title="취소" secondary onPress={onClose} /></View>
          <View style={{ flex: 1 }}><Button title="저장" disabled={!draft.trim()} onPress={save} /></View>
        </View>
      </FadeIn>
    </View>
  </Modal>;
}

function SharingAndReminderSettings() {
  const roleActions = useRoleActions();
  const { state, update, notify, notificationStatus, setNotificationStatus, confirm } = useCare();
  const [busy, setBusy] = useState(false);
  const [editingReminder, setEditingReminder] = useState<ReminderKind | null>(null);
  const [editingName, setEditingName] = useState(false);
  const isWeb = Platform.OS === 'web';
  const remindersOn = state.reminders.appointment || state.reminders.medication;
  const notificationProblem = remindersOn && (notificationStatus.status === 'error' || notificationStatus.status === 'denied');

  const toggleReminder = async (key: 'appointment' | 'medication', enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (enabled && !isWeb) {
        const permission = await requestReminderPermission();
        setNotificationStatus(permission);
        if (permission.status !== 'ready') { notify(permission.message); return; }
      }
      update(value => ({ ...value, reminders: { ...value.reminders, [key]: enabled } }));
    } finally { setBusy(false); }
  };

  return (
    <>
      <CaregiverLinkCard confirm={confirm} onEditName={() => setEditingName(true)} />
      {editingName && <NameEditor onClose={() => setEditingName(false)} />}
      <Card>
        <Text style={s.section}>알림</Text>
        <View>
          <ReminderRow title="진료 일정" values={state.reminders.appointmentMinutesBefore} enabled={state.reminders.appointment} busy={busy} onEdit={() => setEditingReminder('appointment')} onToggle={value => void toggleReminder('appointment', value)} />
          <View style={s.divider} />
          <ReminderRow title="복약" values={state.reminders.medicationMinutesBefore} enabled={state.reminders.medication} busy={busy} onEdit={() => setEditingReminder('medication')} onToggle={value => void toggleReminder('medication', value)} />
        </View>
        {!isWeb && notificationProblem && <Text accessibilityRole="alert" style={[s.muted, { color: '#a66b1d' }]}>{notificationStatus.message}</Text>}
      </Card>
      {roleActions && <TextAction label="역할 변경" onPress={roleActions.changeRole} />}
      {editingReminder !== null && <ReminderTimePicker
        kind={editingReminder}
        values={editingReminder === 'appointment' ? state.reminders.appointmentMinutesBefore : state.reminders.medicationMinutesBefore}
        onClose={() => setEditingReminder(null)}
        onSave={minutes => {
          if (update(current => setReminderOffsets(current, editingReminder, minutes), '알림 시간을 저장했어요.')) setEditingReminder(null);
        }}
      />}
    </>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 16 },
  itemTitle: { color: C.navy, fontSize: 15, fontWeight: '600' },
  itemContent: { flex: 1, gap: 5 },
  textAction: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' },
  actionText: { color: C.blue, fontSize: 13, fontWeight: '600' },
  recordAction: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  doseRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, paddingVertical: 10 },
  captureButton: { minWidth: 80, minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 8, backgroundColor: C.pale },
  captureLabel: { color: C.blue, fontSize: 14, fontWeight: '600' },
  nextTitle: { color: C.navy, fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  nextStatus: { color: '#495b76', fontSize: 16, fontWeight: '600' },
  settingRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 9 },
  reminderDetails: { minHeight: 52, justifyContent: 'center', paddingVertical: 6 },
  backdrop: { flex: 1, backgroundColor: '#14213b66', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  sheet: { width: '100%', maxWidth: 440, backgroundColor: C.white, borderRadius: 16, padding: 20, gap: 14 },
});
