import { Redirect } from 'expo-router';
import { useAppRole } from '../app-role';
export default function SettingsLink() {
  return <Redirect href={useAppRole().role === 'caregiver' ? '/caregiver/settings' : '/patient-settings'} />;
}
