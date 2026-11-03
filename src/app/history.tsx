import { Redirect, useLocalSearchParams } from 'expo-router';
import { useAppRole } from '../app-role';
export default function HistoryLink() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  return <Redirect href={useAppRole().role === 'caregiver' ? { pathname: '/caregiver/history', params: { date: date ?? '' } } : '/medication'} />;
}
