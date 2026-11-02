import { validateLoadedState, type AppState } from './domain.ts';

/** Only visit data has cross-tab revisions. Never replace unrelated optimistic changes. */
export function withNewerVisits(state: AppState, saved: AppState): AppState {
  if (saved.visitsRevision <= state.visitsRevision) return state;
  return { ...state, visits: saved.visits, visitsRevision: saved.visitsRevision };
}

export async function writeWebState(
  key: string,
  state: AppState,
  change?: (state: AppState) => AppState,
  replaceUnreadable = false,
): Promise<AppState> {
  const write = () => {
    // AsyncStorage web uses this same localStorage key. Keep the read and write
    // together so an operation always runs against the latest persisted visits.
    const raw = window.localStorage.getItem(key);
    let base = state;
    if (raw !== null) {
      try { base = withNewerVisits(state, validateLoadedState(JSON.parse(raw))); }
      catch (error) { if (!replaceUnreadable) throw error; }
    }
    const next = change ? change(base) : base;
    window.localStorage.setItem(key, JSON.stringify(next));
    return next;
  };
  return window.navigator.locks ? window.navigator.locks.request(key, write) : write();
}

export function onWebVisitsChanged(key: string, accept: (saved: AppState) => void) {
  const listener = (event: StorageEvent) => {
    if (event.storageArea !== window.localStorage || event.key !== key || !event.newValue) return;
    try { accept(validateLoadedState(JSON.parse(event.newValue))); }
    catch { /* A malformed write in another tab cannot replace local records. */ }
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
