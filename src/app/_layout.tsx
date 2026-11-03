import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RoleProvider, useAppRole } from '../app-role';
import { MotionProvider } from '../motion';

export const unstable_settings = { initialRouteName: 'index' };
function Navigation() {
  const { role } = useAppRole();
  return <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
    <Stack.Screen name="index" />
    <Stack.Screen name="sample" />
    <Stack.Protected guard={role !== null}>
      <Stack.Screen name="settings" />
      <Stack.Screen name="history" />
      <Stack.Screen name="medicines" />
    </Stack.Protected>
    <Stack.Protected guard={role === 'patient'}><Stack.Screen name="(patient)" /></Stack.Protected>
    <Stack.Protected guard={role === 'caregiver'}><Stack.Screen name="caregiver" /></Stack.Protected>
  </Stack>;
}
export default function RootLayout() {
  return <SafeAreaProvider><MotionProvider><StatusBar style="dark" /><RoleProvider><Navigation /></RoleProvider></MotionProvider></SafeAreaProvider>;
}
