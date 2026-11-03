import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MotionProvider } from '../../../src/motion';
import { CaregiverArea } from '../caregiver-area';

export default function RootLayout() {
  return <SafeAreaProvider><MotionProvider><StatusBar style="dark" /><CaregiverArea home="/" /></MotionProvider></SafeAreaProvider>;
}
