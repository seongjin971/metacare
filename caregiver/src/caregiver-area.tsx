import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Modal, Text, View } from 'react-native';
import { router, Tabs, usePathname, useRootNavigationState } from 'expo-router';
import { PlatformPressable } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, Icon, s, type IconName } from '../../src/ui';
import { CaregiverProvider, useCaregiver } from './store';
import { ConnectScreen } from './connect-screen';
import { CareButton, colors, styles } from './components';
import { CARE_ALERT_TYPE, consumeAlertTap, supportsCareAlerts, watchAlertTaps } from './alert-device';
import { isCalendarDate } from '../../src/calendar';
type CaregiverHome = '/' | '/caregiver';

function Navigation({ home }: { home: CaregiverHome }) {
  const settings = home === '/' ? '/settings' : '/caregiver/settings';
  const { ready, mode, data, offerAlerts, dismissAlertOffer } = useCaregiver();
  const handledAlert = useRef('');
  const connectedAt = data?.connectedAt;
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
  useEffect(() => {
    if (!supportsCareAlerts || !root?.key || mode !== 'connected' || !connectedAt) return;
    // A tap opens that day's records, only for the pairing that received it.
    const subscription = watchAlertTaps(response => {
      const { request, date: delivered } = response.notification;
      const payload = request.content.data;
      const id = `${request.identifier}-${delivered}`;
      if (payload?.type !== CARE_ALERT_TYPE) return;
      if (payload.connectedAt === connectedAt && isCalendarDate(payload.date) && handledAlert.current !== id) {
        handledAlert.current = id;
        router.navigate({ pathname: home, params: { date: payload.date } });
      }
      consumeAlertTap();
    });
    return () => subscription.remove();
  }, [root?.key, mode, connectedAt, home]);
  if (!ready) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, backgroundColor: C.bg }}><ActivityIndicator color={colors.teal} /><Text style={s.body}>연결 정보를 불러오는 중이에요.</Text></View>;
  if (mode === 'disconnected') return <ConnectScreen />;
  return <><Tabs backBehavior="history" screenOptions={{
    headerShown: false,
    tabBarButton: props => <PlatformPressable {...props} pressColor="transparent" android_ripple={{ color: 'transparent' }} pressOpacity={1} hoverEffect={undefined} />,
    tabBarActiveTintColor: colors.teal, tabBarInactiveTintColor: '#83919A',
    tabBarStyle: { borderTopColor: colors.line, paddingTop: 10, paddingBottom: Math.max(12, inset.bottom), height: 64 + Math.max(12, inset.bottom), backgroundColor: 'white' },
    tabBarLabelStyle: { fontSize: 12, fontWeight: '600', marginTop: 4 },
    sceneStyle: { backgroundColor: C.bg }, tabBarHideOnKeyboard: true,
  }}>
    {([['index', '복약', 'medical-outline'], ['visits', '진료 일정', 'calendar-outline'], ['settings', '관리', 'options-outline']] as [string, string, IconName][]).map(([name, title, icon]) => <Tabs.Screen key={name} name={name} options={{ title, tabBarIcon: ({ color }) => <Icon name={icon} color={String(color)} size={22} /> }} />)}
    {/* Kept only to redirect older links into the medication tab. href: null would also drop the route from linking. */}
    <Tabs.Screen name="history" options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }} />
  </Tabs>
    <Modal visible={mode === 'connected' && supportsCareAlerts && offerAlerts} transparent onRequestClose={dismissAlertOffer}>
      <View style={styles.modalBackdrop}><View accessibilityViewIsModal style={styles.modalCard}>
        <Text accessibilityRole="header" style={s.section}>복약 미기록 알림을 받을까요?</Text>
        <Text style={s.body}>정한 시간까지 기록이 없으면 이 휴대폰으로 한 번 알려드려요.</Text>
        <CareButton title="알림 설정" onPress={() => { dismissAlertOffer(); router.navigate(settings); }} />
        <CareButton title="나중에" secondary onPress={dismissAlertOffer} />
      </View></View>
    </Modal>
  </>;
}

export function CaregiverArea({ home }: { home: CaregiverHome }) {
  return <CaregiverProvider><Navigation home={home} /></CaregiverProvider>;
}
