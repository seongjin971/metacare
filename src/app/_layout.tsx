import React, { useEffect } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { PlatformPressable } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CareProvider } from '../store';
import { C, Icon, IconName } from '../ui';
import { useNotificationNavigation } from '../notification-navigation';
import { MotionProvider, useMotionValue, useReducedMotion } from '../motion';

function TabIcon({ name, color, focused }: { name: IconName; color: string; focused: boolean }) {
  const reducedMotion = useReducedMotion();
  const progress = useMotionValue(focused ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(focused ? 1 : 0);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: focused ? 1 : 0,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [focused, progress, reducedMotion]);
  return <Animated.View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center', transform: [{ scale: reducedMotion ? 1 : progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }] }}>
    <Icon name={name} color={color} size={22} />
  </Animated.View>;
}

function Navigation() {
  useNotificationNavigation();
  const inset = useSafeAreaInsets();
  return <><StatusBar style="dark" /><Tabs screenOptions={{ headerShown: false, tabBarButton: props => <PlatformPressable {...props} pressColor="transparent" android_ripple={{ color: 'transparent' }} pressOpacity={1} hoverEffect={undefined} />, tabBarActiveTintColor: C.blue, tabBarInactiveTintColor: '#8b96a9', tabBarStyle: { borderTopColor: C.line, paddingTop: 10, paddingBottom: Math.max(12, inset.bottom), height: 64 + Math.max(12, inset.bottom), backgroundColor: 'white' }, tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginTop: 4 }, sceneStyle: { backgroundColor: C.bg }, tabBarHideOnKeyboard: true }}>
    {([['index', '복약', 'medical-outline'], ['appointments', '진료 일정', 'calendar-outline'], ['consultation', '상담', 'chatbubbles-outline'], ['settings', '내 관리', 'person-outline']] as [string, string, IconName][]).map(([name, title, icon]) => <Tabs.Screen key={name} name={name} options={{ title, tabBarIcon: ({ color, focused }) => <TabIcon name={icon} color={String(color)} focused={focused} /> }} />)}
    <Tabs.Screen name="medicines" options={{ href: null }} />
  </Tabs></>;
}
export default function RootLayout() { return <SafeAreaProvider><MotionProvider><CareProvider><Navigation /></CareProvider></MotionProvider></SafeAreaProvider>; }
