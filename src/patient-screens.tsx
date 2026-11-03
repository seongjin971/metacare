import React, { useCallback, useState } from 'react';
import { Platform, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Dose, localDateKey, recordDose, setMedicationSchedule, setReminderOffsets, setSharing } from './domain';
import { shiftMonth, startOfMonth } from './calendar';
import { MonthCalendar } from './month-calendar';
import { dosesForHistoryDate, summarizeDosesByDate } from './medication-history';
import { MedicationHistoryCard } from './medication-history-card';
import { useCare } from './store';
import { Button, C, Card, Icon, Page, s } from './ui';
import { requestReminderPermission, scheduleTestReminder, syncReminders } from './notifications';
import { formatReminderOffset, ReminderKind } from './reminder-settings';
import { ReminderTimePicker } from './reminder-time-picker';
import { medicationScheduleLabel } from './medication-schedule';
import { MedicationSchedulePicker } from './medication-schedule-picker';
import { DoseCamera } from './dose-camera';
import { isPhotoAnalyzerAvailable, type VerifiedDoseCapture } from './verify-dose-photo';
import { DosePhotoButton } from './dose-photo-button';
import { removeDosePhoto, saveDosePhoto } from './dose-photo-storage';
import { savePhotoRecord } from './save-photo-record';
import { FadeIn, MotionPressable as Pressable } from './motion';
import { CaregiverLinkCard } from './caregiver-link';
import { HospitalContactCard } from './hospital-contact-card';
import { useRoleActions } from './role-actions';

function TextAction({ label, onPress, accessibilityLabel }: { label: string; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} style={styles.textAction}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={styles.disclosure}>
        <Text style={styles.itemTitle}>{title}</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={17} color={C.muted} />
      </Pressable>
      {open && <FadeIn style={styles.disclosureBody}>{children}</FadeIn>}
    </View>
  );
}

function DoseRow({ dose, canCapture }: { dose: Dose; canCapture: boolean }) {
  const { commit, confirm, notify } = useCare();
  const [cameraOpen, setCameraOpen] = useState(false);
  useFocusEffect(useCallback(() => () => setCameraOpen(false), []));
  const taken = dose.status === 'taken';
  const recordedTime = dose.takenAt
    ? new Date(dose.takenAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
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
  return (
    <>
    <View style={styles.doseRow}>
      <View style={styles.itemContent}>
        <Text style={styles.itemTitle}>{dose.label}</Text>
        <Text style={s.muted}>{dose.time}{taken && <Text style={{ color: C.green }}> · {dose.photo?.verification ? '사진 인증' : dose.photo ? '사진 기록' : '자가 기록'} {recordedTime}</Text>}</Text>
      </View>
      {!taken && canCapture ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${dose.label} 약봉투 촬영`}
          onPress={() => setCameraOpen(true)}
          style={({ pressed }) => [styles.captureButton, pressed && { opacity: 0.7 }]}
        >
          <Icon name="camera-outline" size={18} color={C.blue} />
          <Text style={styles.captureLabel}>약봉투 촬영</Text>
        </Pressable>
      ) : taken ? (
        <View style={s.inline}>
          {dose.photo && <DosePhotoButton photo={dose.photo} label={dose.label} />}
          <Pressable accessibilityRole="button" accessibilityLabel={`${dose.label} 기록 취소`} onPress={undo} style={styles.recordAction}>
            <Text style={s.muted}>기록 취소</Text>
          </Pressable>
        </View>
      ) : <Text style={s.muted}>미기록</Text>}
    </View>
    {cameraOpen && <DoseCamera label={dose.label} onClose={() => setCameraOpen(false)} onSave={saveCapture} />}
    </>
  );
}

function DoseList({ doses }: { doses: Dose[] }) {
  const canCapture = isPhotoAnalyzerAvailable();
  return (
    <View>
      {doses.map((dose, index) => (
        <React.Fragment key={dose.id}>
          {index > 0 && <View style={s.divider} />}
          <DoseRow dose={dose} canCapture={canCapture} />
        </React.Fragment>
      ))}
      {!canCapture && doses.some(dose => dose.status === 'pending') &&
        <Text style={s.micro}>약봉투 촬영은 메타케어 설치 앱에서 할 수 있어요.</Text>}
    </View>
  );
}

export function MedicationScreen() {
  const { state, now } = useCare();
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
  return (
    <Page title="복약">
      <View style={styles.stack}>
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
        {date === today ? <Card>
          <View style={s.inline}>
            <Text style={s.section}>복약 현황</Text>
            {doses.length > 0 && <Text style={[s.muted, done === doses.length && { color: C.green }]}>{done}/{doses.length}</Text>}
          </View>
          {doses.length ? <DoseList doses={doses} /> : <Text style={s.muted}>복약 일정이 없어요.</Text>}
        </Card> : <MedicationHistoryCard key={date} doses={doses} emptyMessage={date > today ? '아직 복약 기록이 없어요.' : '복약 기록이 없어요.'} />}
      </View>
    </Page>
  );
}

function SettingRow({ title, detail, value, disabled, onChange, accessibilityLabel }: {
  title: string; detail?: string; value: boolean; disabled: boolean;
  onChange: (enabled: boolean) => void; accessibilityLabel: string;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.itemContent}>
        <Text style={styles.itemTitle}>{title}</Text>
        {detail && <Text style={s.muted}>{detail}</Text>}
      </View>
      <Switch accessibilityLabel={accessibilityLabel} disabled={disabled} value={value} onValueChange={onChange} trackColor={{ false: '#dfe5ee', true: C.blue }} thumbColor="white" />
    </View>
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
  const roleActions = useRoleActions();
  const { state, update, confirm, notify, notificationStatus, setNotificationStatus, now } = useCare();
  const [busy, setBusy] = useState(false);
  const [editingReminder, setEditingReminder] = useState<ReminderKind | null>(null);
  const [editingMedication, setEditingMedication] = useState(false);
  const hasRecordedToday = state.doses.some(dose => dose.date === localDateKey(now) && dose.status === 'taken');
  const isWeb = Platform.OS === 'web';
  const notificationProblem = notificationStatus.status === 'error' || notificationStatus.status === 'denied';

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

  const toggleHospitalShare = (enabled: boolean) => {
    if (!enabled) {
      update(value => setSharing(value, 'hospital', false), '공유를 중지했어요.');
      return;
    }
    confirm({
      title: '병원에게 공유할까요?',
      body: '복약 일정·복용 여부·기록 시간을 공유하도록 설정합니다. 현재 실제 계정 연결은 지원하지 않습니다. 언제든 끌 수 있습니다.',
      label: '공유 허용',
      onConfirm: () => update(value => setSharing(value, 'hospital', true), '공유를 허용했어요.'),
    });
  };

  const testReminder = async () => {
    if (busy || isWeb) return;
    setBusy(true);
    try {
      const permission = await requestReminderPermission();
      if (permission.status !== 'ready') {
        setNotificationStatus(permission);
        notify(permission.message);
        return;
      }
      const result = await scheduleTestReminder();
      notify(result.message);
    } finally { setBusy(false); }
  };

  return (
    <Page title="내 관리">
      <View style={styles.stack}>
        <Card>
          <Pressable accessibilityRole="button" accessibilityLabel="복약 설정" onPress={() => setEditingMedication(true)} style={[s.row, { minHeight: 56, gap: 16 }]}>
            <View style={styles.itemContent}>
              <Text style={s.section}>복약 설정</Text>
              <Text style={s.body}>{medicationScheduleLabel(state.medicationSchedule)}</Text>
              <Text style={s.muted}>{state.medicationSchedule.times.join(' · ')}</Text>
            </View>
            <Icon name="chevron-forward" size={18} color={C.muted} />
          </Pressable>
        </Card>
        <HospitalContactCard editable />
        <CaregiverLinkCard confirm={confirm} />
        <Card>
          <Text style={s.section}>병원 공유 설정</Text>
          <View>
            <SettingRow title="병원" value={state.sharing.hospital} disabled={false} onChange={toggleHospitalShare} accessibilityLabel="병원 복약 기록 공유" />
          </View>
          <Text style={s.muted}>복약 일정·복용 여부·기록 시간의 공유 의향을 저장합니다. 실제 병원 계정 연결은 아직 지원하지 않아요.</Text>
        </Card>
        <Card>
          <Text style={s.section}>알림</Text>
          <View>
            <ReminderRow title="진료 일정" values={state.reminders.appointmentMinutesBefore} enabled={state.reminders.appointment} busy={busy} onEdit={() => setEditingReminder('appointment')} onToggle={value => void toggleReminder('appointment', value)} />
            <View style={s.divider} />
            <ReminderRow title="복약" values={state.reminders.medicationMinutesBefore} enabled={state.reminders.medication} busy={busy} onEdit={() => setEditingReminder('medication')} onToggle={value => void toggleReminder('medication', value)} />
          </View>
          {!isWeb && notificationProblem && <Text accessibilityRole="alert" style={[s.muted, { color: '#a66b1d' }]}>{notificationStatus.message}</Text>}
        </Card>
        {!isWeb && (
          <Disclosure title="알림 점검">
            <Text style={s.muted}>{notificationStatus.message}</Text>
            <Button title={busy ? '확인 중…' : '10초 뒤 테스트 알림'} small secondary disabled={busy} onPress={() => void testReminder()} />
            <TextAction label="알림 상태 다시 확인" onPress={async () => {
              const result = await syncReminders(state);
              setNotificationStatus(result);
              notify(result.message);
            }} />
            <Text style={s.muted}>기기 설정에 따라 알림이 지연될 수 있습니다.</Text>
          </Disclosure>
        )}
        {roleActions && <TextAction label="역할 변경" onPress={roleActions.changeRole} />}
      </View>
      {editingMedication && <MedicationSchedulePicker
        value={state.medicationSchedule}
        appliesTomorrow={hasRecordedToday}
        onClose={() => setEditingMedication(false)}
        onSave={schedule => {
          const time = new Date();
          const appliesTomorrow = state.doses.some(dose => dose.date === localDateKey(time) && dose.status === 'taken');
          if (update(current => setMedicationSchedule(current, schedule, time), appliesTomorrow ? '저장했어요. 내일부터 적용됩니다.' : '복약 일정을 저장했어요.')) setEditingMedication(false);
        }}
      />}
      {editingReminder !== null && <ReminderTimePicker
        kind={editingReminder}
        values={editingReminder === 'appointment' ? state.reminders.appointmentMinutesBefore : state.reminders.medicationMinutesBefore}
        onClose={() => setEditingReminder(null)}
        onSave={minutes => {
          if (update(current => setReminderOffsets(current, editingReminder, minutes), '알림 시간을 저장했어요.')) setEditingReminder(null);
        }}
      />}
    </Page>
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
  settingRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 9 },
  reminderDetails: { minHeight: 52, justifyContent: 'center', paddingVertical: 6 },
  disclosure: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: C.line },
  disclosureBody: { paddingVertical: 12, gap: 12 },
});
