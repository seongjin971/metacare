export function setForegroundNotificationRole(_role: 'patient' | 'caregiver' | null) {
  // Previously issued web alerts may open a URL containing medication timing.
  if (window.location.hash.startsWith('#care-alert=')) {
    history.replaceState(history.state, '', window.location.pathname + window.location.search);
  }
}
