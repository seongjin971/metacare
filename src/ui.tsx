import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View, useWindowDimensions, ViewStyle, type ScrollViewProps } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotionPressable as Pressable } from './motion';

export const C = { blue: '#3066e9', navy: '#192c4b', muted: '#78849a', line: '#e9edf4', bg: '#f5f7fb', mint: '#e9f7f3', green: '#208472', pale: '#edf2ff', white: '#ffffff' };
export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export function Icon({ name, size = 22, color = C.blue }: { name: IconName; size?: number; color?: string }) { return <Ionicons name={name} size={size} color={color} />; }
export function Badge({ children, tone = 'blue' }: { children: React.ReactNode; tone?: 'blue' | 'green' | 'gray' | 'orange' }) { const colors = { blue: [C.pale, C.blue], green: [C.mint, C.green], gray: ['#f0f2f6', '#758097'], orange: ['#fff4e2', '#a66b1d'] }; return <View style={{ backgroundColor: colors[tone][0], paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignSelf: 'flex-start' }}><Text style={{ color: colors[tone][1], fontSize: 12, fontWeight: '700' }}>{children}</Text></View>; }
export function Button({ title, onPress, icon, secondary = false, disabled = false, small = false }: { title: string; onPress: () => void; icon?: IconName; secondary?: boolean; disabled?: boolean; small?: boolean }) { return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, { minHeight: small ? 44 : 48, backgroundColor: disabled ? '#e4e8f0' : secondary ? C.pale : C.blue, opacity: pressed ? 0.8 : 1 }]}>{icon && <Icon name={icon} size={18} color={secondary ? C.blue : 'white'} />}<Text style={{ fontSize: small ? 14 : 15, fontWeight: '600', color: disabled ? '#8a95a8' : secondary ? C.blue : 'white' }}>{title}</Text></Pressable>; }
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) { return <View style={[s.card, style]}>{children}</View>; }
export function Section({ title, caption, action, onPress }: { title: string; caption?: string; action?: string; onPress?: () => void }) { return <View style={s.row}><View style={{ flex: 1 }}><Text style={s.section}>{title}</Text>{caption && <Text style={[s.muted, { marginTop: 4 }]}>{caption}</Text>}</View>{action && <Pressable accessibilityRole="button" onPress={onPress} style={[s.inline, { minHeight: 44, paddingLeft: 12 }]}><Text style={{ fontSize: 14, color: C.blue }}>{action}</Text><Icon name="chevron-forward" size={14} color={C.blue} /></Pressable>}</View>; }
export function Empty({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return <View style={{ flexDirection: 'row', paddingVertical: 14, gap: 12 }}>
    <Icon name={icon} size={22} color={C.muted} />
    <View style={{ flex: 1, gap: 6 }}><Text style={s.section}>{title}</Text><Text style={s.body}>{body}</Text></View>
  </View>;
}
export function Page({ children, title = '메타케어', scroll = true, scrollsChildToFocus = true, keyboardDismissMode = 'none', scrollRef, scrollViewProps }: { children: React.ReactNode; title?: string; scroll?: boolean; scrollsChildToFocus?: boolean; keyboardDismissMode?: ScrollViewProps['keyboardDismissMode']; scrollRef?: React.Ref<React.ComponentRef<typeof ScrollView>>; scrollViewProps?: Pick<ScrollViewProps, 'onScroll' | 'onScrollBeginDrag' | 'onContentSizeChange' | 'onLayout' | 'scrollEventThrottle'> }) {
  const { width } = useWindowDimensions();
  const inset = useSafeAreaInsets();
  const paddingHorizontal = width > 700 ? 28 : 16;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: inset.top }}>
      <View style={[s.pageWidth, s.row, { paddingHorizontal, minHeight: 66, gap: 12 }]}>
        {title === '메타케어'
          ? <Image source={require('../assets/metacare-icon.png')} accessibilityLabel="메타케어 로고" accessible style={{ width: 32, height: 32, borderRadius: 9 }} />
          : <Text accessibilityRole="header" style={s.title}>{title}</Text>}
      </View>
      {scroll ? (
        <ScrollView ref={scrollRef} {...scrollViewProps} style={{ flex: 1 }} scrollsChildToFocus={scrollsChildToFocus} keyboardDismissMode={keyboardDismissMode} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 20 }}>
          <View style={[s.pageWidth, { paddingHorizontal }]}>{children}</View>
        </ScrollView>
      ) : <View style={[s.pageWidth, { flex: 1, paddingHorizontal, paddingBottom: 8 }]}>{children}</View>}
    </View>
  );
}
export const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, inline: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  pageWidth: { width: '100%', maxWidth: 1000, alignSelf: 'center' },
  title: { color: C.navy, fontSize: 22, fontWeight: '700', letterSpacing: -0.6, lineHeight: 30 }, section: { color: C.navy, fontSize: 16, fontWeight: '600' },
  body: { color: '#617086', fontSize: 14, lineHeight: 22 }, muted: { color: C.muted, fontSize: 13, lineHeight: 20 }, micro: { color: C.muted, fontSize: 12, lineHeight: 18 },
  card: { backgroundColor: 'white', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.line, gap: 12 },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 9, paddingHorizontal: 16 },
  segment: { flexDirection: 'row', padding: 3, backgroundColor: '#e9edf4', borderRadius: 9 }, segmentItem: { paddingHorizontal: 13, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  iconBox: { height: 36, width: 36, borderRadius: 9, backgroundColor: C.pale, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 48, borderRadius: 9, backgroundColor: 'white', borderWidth: 1, borderColor: '#dfe5ee', padding: 12, color: C.navy, fontSize: 15, textAlignVertical: 'top' },
  label: { fontSize: 14, fontWeight: '600', color: '#495b76', marginBottom: 8 }, divider: { height: 1, backgroundColor: C.line },
});
