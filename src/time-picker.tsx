import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { useReducedMotion } from './motion';
import { Button, C, s } from './ui';
import type { TimePickerProps } from './clock-time';
import { TimeTrigger } from './time-trigger';

export function TimePicker({ label, value, initialTime, onChange, disabled }: TimePickerProps) {
  const [draft, setDraft] = useState<Date | null>(null);
  const [error, setError] = useState(false);
  const reducedMotion = useReducedMotion();
  // Android reopens its native dialog when its callback changes. A parent's
  // clock tick or a different inline handler must not reset a wheel in use.
  const change = useRef(onChange);
  useLayoutEffect(() => { change.current = onChange; }, [onChange]);

  function open() {
    setError(false);
    // The picker requires a Date. Fix its date and zone so a DST transition
    // cannot alter the selected hour or minute.
    setDraft(new Date(`2000-01-01T${value ?? initialTime}:00.000Z`));
  }
  const close = useCallback(() => setDraft(null), []);
  const confirm = useCallback((date: Date) => {
    change.current(date.toISOString().slice(11, 16));
    setDraft(null);
  }, []);
  const confirmAndroid = useCallback((_event: DateTimePickerChangeEvent, date: Date) => confirm(date), [confirm]);

  return <>
    <TimeTrigger label={label} value={value} disabled={disabled} onPress={open} />
    {error && <Text accessibilityRole="alert" style={styles.error}>시간 선택기를 열지 못했어요. 다시 눌러 주세요.</Text>}
    {draft && (Platform.OS === 'android'
      ? <DateTimePicker mode="time" display="spinner" value={draft} timeZoneName="UTC" is24Hour={false}
          positiveButton={{ label: '확인' }} negativeButton={{ label: '취소' }}
          onValueChange={confirmAndroid} onDismiss={close} onError={() => { close(); setError(true); }} />
      : <Modal transparent visible onRequestClose={close} animationType={reducedMotion ? 'none' : 'fade'}>
          <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
            <View accessibilityViewIsModal style={styles.panel}>
              <Text accessibilityRole="header" style={s.section}>{label}</Text>
              <DateTimePicker mode="time" display="spinner" value={draft} timeZoneName="UTC" locale="ko-KR-u-hc-h12"
                style={styles.iosWheel} themeVariant="light" textColor={C.navy}
                onValueChange={(_event, date) => setDraft(date)} />
              <View style={styles.actions}>
                <View style={styles.action}><Button title="취소" secondary onPress={close} /></View>
                <View style={styles.action}><Button title="확인" onPress={() => confirm(draft)} /></View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>)}
  </>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#172b4d66', justifyContent: 'center', alignItems: 'center', padding: 16 },
  panel: { width: '100%', maxWidth: 400, maxHeight: '100%', flexShrink: 1, backgroundColor: C.white, borderRadius: 16, padding: 16, gap: 12 },
  iosWheel: { flexShrink: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
  error: { color: '#a13b35', fontSize: 13 },
});
