import { KeyboardAvoidingView, Platform } from 'react-native';
import { VisitSchedule } from './inline-appointment-booking';
import { Page } from './ui';
import { useBookingScrollAnchor } from './booking-scroll';

export function AppointmentsScreen() {
  const scrollAnchor = useBookingScrollAnchor();
  return (
    // Android already resizes for the IME. A second height adjustment oscillates
    // with floating handwriting keyboards and repeatedly scrolls the focused input.
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" enabled={Platform.OS === 'ios'}>
      <Page title="진료 일정" scrollsChildToFocus={false} keyboardDismissMode="on-drag" scrollRef={scrollAnchor.scrollRef} scrollViewProps={scrollAnchor.scrollViewProps}>
        <VisitSchedule scrollAnchor={scrollAnchor} />
      </Page>
    </KeyboardAvoidingView>
  );
}
