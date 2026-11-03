import { Keyboard, StyleSheet, Text, View } from 'react-native';
import { MotionPressable } from './motion';
import { C, Icon, s } from './ui';
import { formatClockTime } from './clock-time';

type Props = { label: string; value: string | null; onPress: () => void; disabled?: boolean };

export function TimeTrigger({ label, value, onPress, disabled }: Props) {
  const shown = value ? formatClockTime(value) : '시간 선택';
  return <MotionPressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityHint={value ? `현재 ${shown}` : undefined} disabled={disabled}
    onPress={() => { Keyboard.dismiss(); onPress(); }} style={[s.row, styles.field]}>
    <View style={s.inline}><Icon name="time-outline" size={19} color={C.blue} />
      <Text style={[styles.value, !value && { color: C.muted }]}>{shown}</Text></View>
    <Icon name="chevron-down" size={16} color={C.muted} />
  </MotionPressable>;
}

const styles = StyleSheet.create({
  field: { minHeight: 48, paddingHorizontal: 12, borderRadius: 9, borderColor: C.line, borderWidth: 1 },
  value: { color: C.navy, fontSize: 16, fontWeight: '600' },
});
