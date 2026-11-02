import React, { useState } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  defaultMedicationSchedule, MEDICATION_FREQUENCIES, normalizeMedicationSchedule,
  type MedicationFrequency, type MedicationSchedule,
} from './medication-schedule';
import { Button, C, Icon, s } from './ui';
import { FadeIn, MotionPressable as Pressable, useReducedMotion } from './motion';

type TimeInput = { hour: string; minute: string };
type Props = {
  value: MedicationSchedule;
  appliesTomorrow: boolean;
  onSave: (schedule: MedicationSchedule) => void;
  onClose: () => void;
};

function timeInputs(times: string[]): TimeInput[] {
  return times.map(time => {
    const [hour, minute] = time.split(':');
    return { hour, minute };
  });
}

export function MedicationSchedulePicker({ value, appliesTomorrow, onSave, onClose }: Props) {
  const reducedMotion = useReducedMotion();
  const [frequency, setFrequency] = useState(value.frequency);
  const [drafts, setDrafts] = useState<Record<MedicationFrequency, TimeInput[]>>(() => ({
    once: timeInputs(defaultMedicationSchedule('once').times),
    twice: timeInputs(defaultMedicationSchedule('twice').times),
    three: timeInputs(defaultMedicationSchedule('three').times),
    [value.frequency]: timeInputs(value.times),
  }));
  const [error, setError] = useState('');
  const inset = useSafeAreaInsets();
  const option = MEDICATION_FREQUENCIES.find(item => item.value === frequency)!;
  const times = drafts[frequency].map(item => `${item.hour.padStart(2, '0')}:${item.minute.padStart(2, '0')}`);
  const changed = frequency !== value.frequency || times.some((time, index) => time !== value.times[index]);

  const edit = (index: number, field: keyof TimeInput, text: string) => {
    setDrafts(current => ({
      ...current,
      [frequency]: current[frequency].map((item, position) => position === index ? { ...item, [field]: text } : item),
    }));
    setError('');
  };

  const save = () => {
    try {
      if (drafts[frequency].some(item => !/^\d{1,2}$/.test(item.hour) || !/^\d{1,2}$/.test(item.minute))) {
        throw new Error('시와 분을 모두 입력해 주세요.');
      }
      onSave(normalizeMedicationSchedule({ frequency, times }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '복약 시간을 확인해 주세요.');
    }
  };

  return (
    <Modal visible transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.backdrop, { paddingTop: Math.max(16, inset.top), paddingBottom: Math.max(16, inset.bottom) }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={Platform.OS !== 'web'}
      >
        <FadeIn accessibilityViewIsModal accessibilityLabel="복약 설정" style={styles.panel}>
          <Text accessibilityRole="header" style={styles.heading}>복약 설정</Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll} contentContainerStyle={styles.content}>
            <View style={styles.choices}>
              {MEDICATION_FREQUENCIES.map(item => {
                const checked = frequency === item.value;
                return (
                  <Pressable
                    key={item.value}
                    accessibilityRole="radio"
                    accessibilityLabel={item.label}
                    accessibilityState={{ checked }}
                    onPress={() => { setFrequency(item.value); setError(''); }}
                    style={[styles.choice, checked && styles.selected]}
                  >
                    <Text style={[styles.optionText, checked && { color: C.blue }]}>{item.label}</Text>
                    <Icon name={checked ? 'radio-button-on' : 'radio-button-off'} size={21} color={checked ? C.blue : C.muted} />
                  </Pressable>
                );
              })}
            </View>
            <View>
              <View style={[s.row, { marginBottom: 6 }]}>
                <Text style={s.section}>복약 시간</Text>
                <Text style={s.muted}>24시간 기준</Text>
              </View>
              {drafts[frequency].map((time, index) => (
                <View key={`${frequency}-${index}`} style={styles.timeRow}>
                  <Text style={styles.timeLabel}>{option.timeLabels[index]}</Text>
                  <View style={styles.timeFields}>
                    <TextInput
                      accessibilityLabel={`${option.timeLabels[index]} 시`}
                      value={time.hour}
                      onChangeText={text => edit(index, 'hour', text.replace(/\D/g, ''))}
                      onBlur={() => time.hour && edit(index, 'hour', time.hour.padStart(2, '0'))}
                      keyboardType="number-pad"
                      selectTextOnFocus
                      maxLength={2}
                      placeholder="시"
                      placeholderTextColor={C.muted}
                      style={[s.input, styles.timeInput]}
                    />
                    <Text style={styles.colon}>:</Text>
                    <TextInput
                      accessibilityLabel={`${option.timeLabels[index]} 분`}
                      value={time.minute}
                      onChangeText={text => edit(index, 'minute', text.replace(/\D/g, ''))}
                      onBlur={() => time.minute && edit(index, 'minute', time.minute.padStart(2, '0'))}
                      keyboardType="number-pad"
                      selectTextOnFocus
                      maxLength={2}
                      placeholder="분"
                      placeholderTextColor={C.muted}
                      style={[s.input, styles.timeInput]}
                    />
                  </View>
                </View>
              ))}
            </View>
            {appliesTomorrow && <Text style={s.muted}>오늘 기록이 있어 변경한 일정은 내일부터 적용돼요.</Text>}
            {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          </ScrollView>
          <View style={styles.footer}>
            <View style={{ flex: 1 }}><Button title="취소" secondary onPress={onClose} /></View>
            <View style={{ flex: 1 }}><Button title="저장" disabled={!changed} onPress={save} /></View>
          </View>
        </FadeIn>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#14213b66', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  panel: { width: '100%', maxWidth: 440, maxHeight: '94%', backgroundColor: C.white, borderRadius: 16, overflow: 'hidden' },
  heading: { padding: 20, color: C.navy, fontSize: 20, fontWeight: '700' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 20, gap: 20 },
  choices: { gap: 8 },
  choice: { minHeight: 50, borderWidth: 1, borderColor: C.line, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  selected: { backgroundColor: C.pale, borderColor: C.blue },
  optionText: { flex: 1, color: C.navy, fontSize: 15, fontWeight: '600' },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 },
  timeLabel: { flex: 1, color: C.navy, fontSize: 15 },
  timeFields: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeInput: { width: 58, textAlign: 'center', textAlignVertical: 'center', fontSize: 18, fontWeight: '600' },
  colon: { color: C.navy, fontSize: 18 },
  error: { color: '#b04444', fontSize: 13, lineHeight: 20 },
  footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderColor: C.line },
});
