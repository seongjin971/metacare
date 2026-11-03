import React from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotionPressable } from './motion';
import { C, Icon, type IconName } from './ui';
import type { AppRole } from './role-actions';

const roles: { id: AppRole; title: string; description: string; icon: IconName; ink: string; tint: string }[] = [
  { id: 'patient', title: '환자예요', description: '내 복약을 기록해요', icon: 'medical-outline', ink: C.blue, tint: '#ecf2ff' },
  { id: 'caregiver', title: '보호자예요', description: '가족의 복약을 확인해요', icon: 'people-outline', ink: '#147865', tint: '#e7f5ef' },
];
export function RolePicker({ current, choosing, error, onSelect, onCancel }: {
  current: AppRole | null; choosing: AppRole | null; error: string; onSelect: (role: AppRole) => void; onCancel?: () => void;
}) {
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.scroll}>
    <View style={styles.panel}>
      <View style={styles.brand}><Image source={require('../assets/metacare-icon.png')} accessible={false} style={{ width: 32, height: 32, borderRadius: 9 }} /><Text style={styles.brandName}>메타케어</Text></View>
      <Text accessibilityRole="header" style={styles.heading}>{current ? '역할 변경' : '어떻게 사용하시나요?'}</Text>
      {current && <Text style={styles.hint}>역할을 바꾸면 이 기기에서 이전 역할의 알림이 꺼져요. 기록과 연결은 유지돼요.</Text>}
      {roles.map(({ id, title, description, icon, tint, ink }) => <MotionPressable key={id} accessibilityRole="button" accessibilityLabel={title}
        accessibilityHint={description} accessibilityState={{ disabled: !!choosing, selected: current === id }} disabled={!!choosing} onPress={() => onSelect(id)}
        style={({ pressed }) => [styles.card, pressed && { backgroundColor: tint }]}>
        <View style={[styles.icon, { backgroundColor: tint }]}><Icon name={icon} size={25} color={ink} /></View>
        <View style={{ flex: 1, gap: 4 }}><Text style={styles.label}>{title}</Text><Text style={styles.caption}>{description}</Text></View>
        {choosing === id ? <ActivityIndicator size="small" color={ink} /> : current === id ? <Text style={[styles.current, { color: ink }]}>현재 역할</Text> : <Icon name="chevron-forward" size={18} color={C.muted} />}
      </MotionPressable>)}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {onCancel && <MotionPressable accessibilityRole="button" accessibilityLabel="취소" disabled={!!choosing} onPress={onCancel} style={styles.cancel}><Text style={styles.caption}>취소</Text></MotionPressable>}
    </View>
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 34, paddingHorizontal: 22 },
  panel: { width: '100%', maxWidth: 420, gap: 12 },
  brand: { flexDirection: 'row', gap: 9, alignItems: 'center', marginBottom: 12 },
  brandName: { fontSize: 16, fontWeight: '700', color: C.navy },
  heading: { fontSize: 28, fontWeight: '700', color: C.navy, letterSpacing: -0.9, marginBottom: 10 },
  hint: { color: '#54647b', lineHeight: 22, marginBottom: 4 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: 'white', borderWidth: 1, borderColor: C.line, borderRadius: 16, minHeight: 94, padding: 18 },
  icon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  label: { fontSize: 19, fontWeight: '700', color: C.navy },
  caption: { fontSize: 14, lineHeight: 21, color: '#5a687c' },
  current: { fontSize: 13, fontWeight: '600' }, cancel: { alignSelf: 'center', padding: 14 },
  error: { fontSize: 14, color: '#a33b32', lineHeight: 22 },
});
