const prefix = '#care-alert=';
let captured = '';

// Retain only in this page's memory. Legacy notifications open / before the router
// restores the saved caregiver role and may replace the URL during that redirect.
function capture() {
  const hash = window.location.hash;
  if (hash.startsWith(prefix) && hash.length <= 1024) captured = hash;
}
if (typeof window !== 'undefined') {
  capture();
  window.addEventListener('hashchange', capture);
}

export function takeCareAlertLaunch(): Record<string, unknown> | null {
  capture();
  const hash = captured;
  clearCareAlertLaunch();
  if (!hash) return null;
  try {
    const data = JSON.parse(decodeURIComponent(hash.slice(prefix.length)));
    return data?.type === 'overdue-dose' ? data : null;
  } catch { return null; }
}

export function clearCareAlertLaunch() {
  captured = '';
  if (typeof window !== 'undefined' && window.location.hash.startsWith(prefix))
    history.replaceState(history.state, '', window.location.pathname + window.location.search);
}
