import React, { useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { completeSetup, MAX_PATIENT_NAME, normalizePatientName } from './domain';
import {
  defaultMedicationSchedule, MEDICATION_FREQUENCIES, normalizeMedicationSchedule,
  type MedicationFrequency, type MedicationSchedule,
} from './medication-schedule';
import { requestReminderPermission } from './notifications';
import { useCare } from './store';
import { TimePicker } from './time-picker';
import { MotionPressable as Pressable } from './motion';
import { Button, C, Icon, s } from './ui';

type Step = 'name' | 'schedule' | 'reminders';

/** First run for a patient: who they are, when they take medicine, and whether to be reminded. */
export function PatientSetup() {
  const { state, commit } = useCare();
  const web = Platform.OS === 'web';
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<MedicationFrequency>(state.medicationSchedule.frequency);
  const [drafts, setDrafts] = useState<Record<MedicationFrequency, string[]>>(() => ({
    once: defaultMedicationSchedule('once').times,
    twice: defaultMedicationSchedule('twice').times,
    three: defaultMedicationSchedule('three').times,
    [state.medicationSchedule.frequency]: [...state.medicationSchedule.times],
  }));
  const [schedule, setSchedule] = useState<MedicationSchedule | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const option = MEDICATION_FREQUENCIES.find(item => item.value === frequency)!;
  const steps: Step[] = web ? ['name', 'schedule'] : ['name', 'schedule', 'reminders'];

  const finish = async (chosen: MedicationSchedule, reminders: boolean) => {
    setBusy(true);
    try {
      await commit(current => {
        const named = completeSetup(current, name, chosen, new Date());
        return reminders ? { ...named, reminders: { ...named.reminders, medication: true, appointment: true } } : named;
      }, reminders ? '설정을 마쳤어요. 약 먹을 시간에 알려드릴게요.' : '설정을 마쳤어요.');
    } finally { setBusy(false); }
  };

  const next = async () => {
    setError('');
    try {
      if (step === 'name') { normalizePatientName(name); setStep('schedule'); return; }
      if (step === 'schedule') {
        const chosen = normalizeMedicationSchedule({ frequency, times: drafts[frequency] });
        setSchedule(chosen);
        if (web) await finish(chosen, false);
        else setStep('reminders');
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '입력한 내용을 확인해 주세요.'); }
  };

  const enableReminders = async () => {
    if (!schedule || busy) return;
    setBusy(true);
    const permission = await requestReminderPermission().finally(() => setBusy(false));
    if (permission.status !== 'ready') {
      setError('알림 권한을 받지 못했어요. 나중에 내 관리 → 알림에서 켤 수 있어요.');
      return;
    }
    await finish(schedule, true);
  };

  const back = () => { setError(''); setStep(steps[Math.max(0, steps.indexOf(step) - 1)]); };

  return <SafeAreaView style={styles.page}>
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.panel}>
        <View style={styles.brand}>
          <Image source={require('../assets/metacare-icon.png')} accessible={false} style={{ width: 28, height: 28, borderRadius: 8 }} />
          <Text style={styles.progress}>{steps.indexOf(step) + 1} / {steps.length}</Text>
        </View>

        {step === 'name' && <>
          <Text accessibilityRole="header" style={styles.heading}>이름을 알려주세요</Text>
          <Text style={styles.hint}>보호자와 연결하면 보호자 화면에 이 이름으로 표시돼요.</Text>
          <TextInput accessibilityLabel="내 이름" value={name} onChangeText={value => { setName(value); setError(''); }}
            placeholder="예: 김정희" placeholderTextColor="#8C99A4" maxLength={MAX_PATIENT_NAME} autoFocus returnKeyType="next"
            onSubmitEditing={() => void next()} style={[s.input, styles.bigInput]} />
        </>}

        {step === 'schedule' && <>
          <Text accessibilityRole="header" style={styles.heading}>약은 하루에 몇 번 드세요?</Text>
          <Text style={styles.hint}>시간마다 약봉투를 촬영해 기록해요. 나중에 내 관리에서 바꿀 수 있어요.</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="복약 횟수" style={{ gap: 8 }}>
            {MEDICATION_FREQUENCIES.map(item => {
              const checked = frequency === item.value;
              return <Pressable key={item.value} accessibilityRole="radio" accessibilityLabel={item.label} accessibilityState={{ checked }}
                onPress={() => { setFrequency(item.value); setError(''); }} style={[styles.choice, checked && styles.selected]}>
                <Text style={[styles.choiceText, checked && { color: C.blue }]}>{item.label}</Text>
                <Icon name={checked ? 'radio-button-on' : 'radio-button-off'} size={22} color={checked ? C.blue : C.muted} />
              </Pressable>;
            })}
          </View>
          <View style={{ gap: 4 }}>
            {drafts[frequency].map((time, index) => <View key={`${frequency}-${index}`} style={styles.timeRow}>
              <Text style={styles.timeLabel}>{option.timeLabels[index]}</Text>
              <View style={{ flex: 2 }}>
                <TimePicker label={frequency === 'once' ? '복약 시간 선택' : `${option.timeLabels[index]} 복약 시간 선택`} value={time} initialTime={time}
                  onChange={value => setDrafts(current => ({ ...current, [frequency]: current[frequency].map((item, position) => position === index ? value : item) }))} />
              </View>
            </View>)}
          </View>
        </>}

        {step === 'reminders' && <>
          <Text accessibilityRole="header" style={styles.heading}>약 먹을 시간에 알려드릴까요?</Text>
          <Text style={styles.hint}>복약 시간과 진료 일정에 맞춰 이 휴대폰으로 알림을 보내요. 잠금화면에는 약 이름 없이 “확인할 일정이 있어요”라고만 표시돼요.</Text>
        </>}

        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}

        <View style={{ gap: 10, marginTop: 8 }}>
          {step === 'reminders' ? <>
            <Button title={busy ? '확인 중…' : '알림 받기'} icon="notifications-outline" disabled={busy} onPress={() => void enableReminders()} />
            <Button title="나중에 할게요" secondary disabled={busy} onPress={() => schedule && void finish(schedule, false)} />
          </> : <Button title={busy ? '저장 중…' : step === 'schedule' && web ? '시작하기' : '다음'} disabled={busy || (step === 'name' && !name.trim())} onPress={() => void next()} />}
          {step !== 'name' && <Pressable accessibilityRole="button" accessibilityLabel="이전" disabled={busy} onPress={back} style={styles.back}>
            <Text style={s.body}>이전</Text>
          </Pressable>}
        </View>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  // Top-aligned so the action button stays above the on-screen keyboard on the name step.
  scroll: { flexGrow: 1, alignItems: 'center', paddingTop: 56, paddingBottom: 34, paddingHorizontal: 22 },
  panel: { width: '100%', maxWidth: 420, gap: 14 },
  brand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  progress: { color: C.muted, fontSize: 14, fontWeight: '600' },
  heading: { fontSize: 26, fontWeight: '700', color: C.navy, letterSpacing: -0.8, lineHeight: 36 },
  hint: { color: '#54647b', fontSize: 15, lineHeight: 23 },
  bigInput: { fontSize: 18, minHeight: 56 },
  choice: { minHeight: 56, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 16, backgroundColor: 'white', flexDirection: 'row', alignItems: 'center' },
  selected: { backgroundColor: C.pale, borderColor: C.blue },
  choiceText: { flex: 1, color: C.navy, fontSize: 17, fontWeight: '600' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  timeLabel: { flex: 1, color: C.navy, fontSize: 16 },
  error: { color: '#a33b32', fontSize: 14, lineHeight: 22 },
  back: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
});
