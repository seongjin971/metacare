import { useNotificationNavigation } from '../../notification-navigation';
import { PatientSetup } from '../../patient-setup';
import { PatientTabs } from '../../patient-tabs';
import { CareProvider, useCare } from '../../store';

function PatientNavigation() {
  useNotificationNavigation();
  const { state } = useCare();
  return state.profile ? <PatientTabs /> : <PatientSetup />;
}

export default function PatientLayout() {
  return <CareProvider><PatientNavigation /></CareProvider>;
}
