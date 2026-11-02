import React, { useState } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  formatReminderOffset, MAX_REMINDER_MINUTES, MAX_REMINDER_TIMES,
  normalizeReminderOffsets, REMINDER_PRESETS, type ReminderKind,
} from './reminder-settings';
import { Button, C, Icon, s } from './ui';
import { FadeIn, MotionPressable as Pressable, useReducedMotion } from './motion';

type Props = {
  kind: ReminderKind;
  values: number[];
  onSave: (minutes: number[]) => void;
  onClose: () => void;
};

const UNITS = [
  { label: '분', multiplier: 1 },
  { label: '시간', multiplier: 60 },
  { label: '일', multiplier: 1440 },
] as const;

export function ReminderTimePicker({ kind, values, onSave, onClose }: Props) {
  const reducedMotion = useReducedMotion();
  const [selected, setSelected] = useState(() => [...values]);
  const [input, setInput] = useState('');
  const [unit, setUnit] = useState<number>(1);
  const [error, setError] = useState('');
  const inset = useSafeAreaInsets();
  const presets = REMINDER_PRESETS[kind];
  const custom = selected.filter(value => !presets.includes(value));
  const title = kind === 'appointment' ? '진료 알림 시간' : '복약 알림 시간';

  const toggle = (minutes: number) => {
    if (selected.includes(minutes)) {
      setSelected(current => current.filter(value => value !== minutes));
      setError('');
      return;
    }
    if (selected.length >= MAX_REMINDER_TIMES) {
      setError(`최대 ${MAX_REMINDER_TIMES}개까지 선택할 수 있어요.`);
      return;
    }
    setSelected(current => [...current, minutes].sort((a, b) => b - a));
    setError('');
  };

  const withInput = () => {
    const raw = input.trim();
    if (!/^\d+$/.test(raw)) throw new Error('0 이상의 정수를 입력해 주세요.');
    const minutes = Number(raw) * unit;
    if (!Number.isSafeInteger(minutes) || minutes > MAX_REMINDER_MINUTES[kind]) {
      throw new Error(kind === 'appointment' ? '최대 30일 전까지 설정할 수 있어요.' : '최대 24시간 전까지 설정할 수 있어요.');
    }
    return normalizeReminderOffsets(kind, [...selected, minutes]);
  };

  const addCustom = () => {
    try {
      setSelected(withInput());
      setInput('');
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '입력한 시간을 확인해 주세요.');
    }
  };

  const save = () => {
    try {
      const next = input.trim() ? withInput() : normalizeReminderOffsets(kind, selected);
      onSave(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '알림 시간을 확인해 주세요.');
    }
  };

  return (
    <Modal visible transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.backdrop, { paddingTop: Math.max(20, inset.top), paddingBottom: Math.max(20, inset.bottom) }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={Platform.OS !== 'web'}
      >
        <FadeIn accessibilityViewIsModal accessibilityLabel={title} style={styles.panel}>
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={styles.title}>{title}</Text>
            <Text style={s.muted}>{selected.length}/{MAX_REMINDER_TIMES}개 선택</Text>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll} contentContainerStyle={styles.content}>
            <View style={styles.options}>
              {presets.map(minutes => {
                const checked = selected.includes(minutes);
                return (
                  <Pressable
                    key={minutes}
                    accessibilityRole="checkbox"
                    accessibilityLabel={formatReminderOffset(minutes)}
                    accessibilityState={{ checked }}
                    onPress={() => toggle(minutes)}
                    style={[styles.option, checked && styles.selected]}
                  >
                    <Text style={[styles.optionText, checked && { color: C.blue }]}>{formatReminderOffset(minutes)}</Text>
                    <Icon name={checked ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={checked ? C.blue : '#bac3d2'} />
                  </Pressable>
                );
              })}
            </View>
            <View style={{ gap: 10 }}>
              <Text style={s.section}>직접 입력</Text>
              <View style={styles.customInput}>
                <TextInput
                  accessibilityLabel="알림을 받을 시간 간격"
                  value={input}
                  onChangeText={value => { setInput(value); setError(''); }}
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="숫자"
                  placeholderTextColor={C.muted}
                  style={[s.input, styles.numberInput]}
                  onSubmitEditing={addCustom}
                />
                <View style={styles.units}>
                  {UNITS.map(item => (
                    <Pressable
                      key={item.multiplier}
                      accessibilityRole="radio"
                      accessibilityLabel={`${item.label} 단위`}
                      accessibilityState={{ checked: unit === item.multiplier }}
                      onPress={() => { setUnit(item.multiplier); setError(''); }}
                      style={[styles.unit, unit === item.multiplier && { backgroundColor: C.white }]}
                    ><Text style={{ color: unit === item.multiplier ? C.navy : C.muted, fontSize: 13 }}>{item.label}</Text></Pressable>
                  ))}
                </View>
                <Button title="추가" small secondary onPress={addCustom} disabled={!input.trim()} />
              </View>
              {custom.map(minutes => (
                <Pressable
                  key={minutes}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatReminderOffset(minutes)} 삭제`}
                  onPress={() => toggle(minutes)}
                  style={[styles.customValue, styles.selected]}
                >
                  <Text style={[styles.optionText, { color: C.blue }]}>{formatReminderOffset(minutes)}</Text>
                  <Icon name="close" size={18} />
                </Pressable>
              ))}
              {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            </View>
          </ScrollView>
          <View style={styles.footer}>
            <View style={{ flex: 1 }}><Button title="취소" secondary onPress={onClose} /></View>
            <View style={{ flex: 1 }}><Button title="저장" onPress={save} disabled={selected.length === 0 && !input.trim()} /></View>
          </View>
        </FadeIn>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#14213b66', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  panel: { width: '100%', maxWidth: 440, maxHeight: '94%', backgroundColor: C.white, borderRadius: 16, overflow: 'hidden' },
  heading: { padding: 20, paddingBottom: 14, gap: 6 },
  title: { color: C.navy, fontSize: 20, fontWeight: '700' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 20, gap: 22 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { flexBasis: '47%', flexGrow: 1, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9, borderWidth: 1, borderColor: C.line, flexDirection: 'row', alignItems: 'center', gap: 8 },
  selected: { backgroundColor: C.pale, borderColor: C.blue },
  optionText: { flex: 1, color: C.navy, fontSize: 14, lineHeight: 20 },
  customInput: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  numberInput: { flex: 1, minWidth: 60, minHeight: 48, textAlign: 'center', textAlignVertical: 'center' },
  units: { flexDirection: 'row', padding: 3, borderRadius: 9, backgroundColor: C.bg },
  unit: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  customValue: { minHeight: 44, borderRadius: 9, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  error: { color: '#b04444', fontSize: 13, lineHeight: 20 },
  footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderColor: C.line },
});
