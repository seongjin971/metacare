import { Redirect, useLocalSearchParams } from 'expo-router';
import { useAppRole } from '../app-role';
export default function HistoryLink() {
  const { date, time } = useLocalSearchParams<{ date?: string; time?: string }>();
  return <Redirect href={useAppRole().role === 'caregiver' ? { pathname: '/caregiver/history', params: { date: date ?? '', time: time ?? '' } } : '/medication'} />;
}
