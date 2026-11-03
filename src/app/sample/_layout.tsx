import { PatientTabs } from '../../patient-tabs';
import { SampleCareProvider } from '../../store';

export default function SampleLayout() {
  return <SampleCareProvider>
    <PatientTabs medicationRoute="index" />
  </SampleCareProvider>;
}
