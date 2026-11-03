import { useNotificationNavigation } from '../../notification-navigation';
import { PatientTabs } from '../../patient-tabs';
import { CareProvider } from '../../store';

function PatientNavigation() {
  useNotificationNavigation();
  return <PatientTabs />;
}

export default function PatientLayout() {
  return <CareProvider><PatientNavigation /></CareProvider>;
}
