import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router, Tabs, usePathname, useRootNavigationState } from 'expo-router';
import { PlatformPressable } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, Icon, s, type IconName } from '../../src/ui';
import { CaregiverProvider, useCaregiver } from './store';
import { ConnectScreen } from './connect-screen';
import { colors } from './components';
type CaregiverHome = '/' | '/caregiver';

function Navigation({ home }: { home: CaregiverHome }) {
  const { ready, mode } = useCaregiver();
  const inset = useSafeAreaInsets();
  const path = usePathname();
  const root = useRootNavigationState();
  const enteredFromConnection = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (mode === 'disconnected') enteredFromConnection.current = true;
    else if (enteredFromConnection.current && root?.key) {
      enteredFromConnection.current = false;
      if (path !== home) router.replace(home);
    }
  }, [ready, mode, root?.key, path, home]);
  if (!ready) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, backgroundColor: C.bg }}><ActivityIndicator color={colors.teal} /><Text style={s.body}>연결 정보를 불러오는 중이에요.</Text></View>;
  if (mode === 'disconnected') return <ConnectScreen />;
  return <Tabs backBehavior="history" screenOptions={{
    headerShown: false,
    tabBarButton: props => <PlatformPressable {...props} pressColor="transparent" android_ripple={{ color: 'transparent' }} pressOpacity={1} hoverEffect={undefined} />,
    tabBarActiveTintColor: colors.teal, tabBarInactiveTintColor: '#83919A',
    tabBarStyle: { borderTopColor: colors.line, paddingTop: 10, paddingBottom: Math.max(12, inset.bottom), height: 64 + Math.max(12, inset.bottom), backgroundColor: 'white' },
    tabBarLabelStyle: { fontSize: 12, fontWeight: '600', marginTop: 4 },
    sceneStyle: { backgroundColor: C.bg }, tabBarHideOnKeyboard: true,
  }}>
    {([['index', '오늘', 'today-outline'], ['history', '기록', 'calendar-outline'], ['settings', '관리', 'options-outline']] as [string, string, IconName][]).map(([name, title, icon]) => <Tabs.Screen key={name} name={name} options={{ title, tabBarIcon: ({ color }) => <Icon name={icon} color={String(color)} size={22} /> }} />)}
  </Tabs>;
}

export function CaregiverArea({ home }: { home: CaregiverHome }) {
  return <CaregiverProvider><Navigation home={home} /></CaregiverProvider>;
}
