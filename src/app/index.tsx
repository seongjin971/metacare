import { Redirect, useLocalSearchParams } from 'expo-router';
import { useAppRole } from '../app-role';
import { RolePicker } from '../role-picker';

export default function Home() {
  const { role, choose, busy, error } = useAppRole();
  const { reminder } = useLocalSearchParams<{ reminder?: string }>();
  if (!role) return <RolePicker current={null} choosing={busy} error={error} onSelect={choose} />;
  if (role === 'caregiver') return <Redirect href="/caregiver" />;
  return <Redirect href={typeof reminder === 'string' ? { pathname: '/medication', params: { reminder } } : '/medication'} />;
}
