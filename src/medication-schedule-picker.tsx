import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  defaultMedicationSchedule, MEDICATION_FREQUENCIES, normalizeMedicationSchedule,
  type MedicationFrequency, type MedicationSchedule,
} from './medication-schedule';
import { Button, C, Icon, s } from './ui';
import { FadeIn, MotionPressable as Pressable, useReducedMotion } from './motion';
import { TimePicker } from './time-picker';

type Props = {
  value: MedicationSchedule;
  appliesTomorrow: boolean;
  onSave: (schedule: MedicationSchedule) => void;
  onClose: () => void;
};

export function MedicationSchedulePicker({ value, appliesTomorrow, onSave, onClose }: Props) {
  const reducedMotion = useReducedMotion();
  const [frequency, setFrequency] = useState(value.frequency);
  const [drafts, setDrafts] = useState<Record<MedicationFrequency, string[]>>(() => ({
    once: defaultMedicationSchedule('once').times,
    twice: defaultMedicationSchedule('twice').times,
    three: defaultMedicationSchedule('three').times,
    [value.frequency]: [...value.times],
  }));
  const [error, setError] = useState('');
  const inset = useSafeAreaInsets();
  const option = MEDICATION_FREQUENCIES.find(item => item.value === frequency)!;
  const times = drafts[frequency];
  const changed = frequency !== value.frequency || times.some((time, index) => time !== value.times[index]);

  const setTime = (index: number, time: string) => {
    setDrafts(current => ({
      ...current,
      [frequency]: current[frequency].map((item, position) => position === index ? time : item),
    }));
    setError('');
  };

  const save = () => {
    try {
      onSave(normalizeMedicationSchedule({ frequency, times }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '복약 시간을 확인해 주세요.');
    }
  };

  return (
    <Modal visible transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingTop: Math.max(16, inset.top), paddingBottom: Math.max(16, inset.bottom) }]}>
        <FadeIn accessibilityViewIsModal accessibilityLabel="복약 설정" style={styles.panel}>
          <Text accessibilityRole="header" style={styles.heading}>복약 설정</Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <View accessibilityRole="radiogroup" accessibilityLabel="복약 횟수" style={styles.choices}>
              {MEDICATION_FREQUENCIES.map(item => {
                const checked = frequency === item.value;
                return (
                  <Pressable
                    key={item.value}
                    accessibilityRole="radio"
                    accessibilityLabel={item.label}
                    accessibilityState={{ checked }}
                    aria-checked={checked}
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
              <Text style={s.section}>복약 시간</Text>
              {times.map((time, index) => (
                <View key={`${frequency}-${index}`} style={styles.timeRow}>
                  <Text style={styles.timeLabel}>{option.timeLabels[index]}</Text>
                  <View style={styles.timeField}>
                    <TimePicker label={frequency === 'once' ? '복약 시간 선택' : `${option.timeLabels[index]} 복약 시간 선택`}
                      value={time} initialTime={time} onChange={next => setTime(index, next)} />
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
      </View>
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
  timeField: { flex: 2 },
  error: { color: '#b04444', fontSize: 13, lineHeight: 20 },
  footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderColor: C.line },
});
