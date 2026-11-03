import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router, Tabs, usePathname, useRootNavigationState } from 'expo-router';
import { PlatformPressable } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotionProvider } from '../../../src/motion';
import { C, Icon, s, type IconName } from '../../../src/ui';
import { CaregiverProvider, useCaregiver } from '../store';
import { ConnectScreen } from '../connect-screen';
import { colors } from '../components';
import { consumeAlertTap, supportsCareAlerts, watchAlertTaps } from '../alert-device';
import { isCalendarDate } from '../../../src/calendar';

function Navigation() {
  const { ready, mode, data } = useCaregiver();
  const inset = useSafeAreaInsets();
  const path = usePathname();
  const root = useRootNavigationState();
  const enteredFromConnection = useRef(false);
  const handledAlert = useRef('');
  const connectedAt = data?.connectedAt;
  useEffect(() => {
    if (!ready) return;
    if (mode === 'disconnected') enteredFromConnection.current = true;
    else if (enteredFromConnection.current && root?.key) {
      enteredFromConnection.current = false;
      if (path !== '/') router.replace('/');
    }
  }, [ready, mode, root?.key, path]);
  useEffect(() => {
    if (!supportsCareAlerts || !root?.key || mode !== 'connected' || !connectedAt) return;
    const subscription = watchAlertTaps(response => {
      const { request, date: delivered } = response.notification;
      const payload = request.content.data;
      const id = `${request.identifier}-${delivered}`;
      if (payload?.type === 'overdue-dose' && payload.connectedAt === connectedAt && isCalendarDate(payload.date)
          && typeof payload.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(payload.time) && handledAlert.current !== id) {
        handledAlert.current = id;
        router.navigate({ pathname: '/history', params: { date: payload.date, time: payload.time, alert: id } });
      }
      consumeAlertTap();
    });
    return () => subscription.remove();
  }, [root?.key, mode, connectedAt]);
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

export default function RootLayout() {
  return <SafeAreaProvider><MotionProvider><CaregiverProvider><StatusBar style="dark" /><Navigation /></CaregiverProvider></MotionProvider></SafeAreaProvider>;
}
