import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { MedicationScreen } from '../patient-screens';

export default function MedicationRoute() {
  const { reminder } = useLocalSearchParams<{ reminder?: string }>();
  // Opening a new reminder resets selected history to today's recording screen.
  return <MedicationScreen key={reminder ?? 'default'} />;
}
