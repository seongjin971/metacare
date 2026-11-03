import { validateLoadedState, type AppState } from './domain.ts';

/** Changing the preferred clinic and editing a visit are independent writes. */
export function mergeNewerVisitData(state: AppState, saved: AppState): AppState {
  let next = state;
  if (saved.visitsRevision > state.visitsRevision) {
    next = { ...next, visits: saved.visits, visitsRevision: saved.visitsRevision };
  }
  if (saved.hospitalContactsRevision > state.hospitalContactsRevision) {
    next = { ...next, hospitalContact: saved.hospitalContact, otherHospitalContacts: saved.otherHospitalContacts,
      hospitalContactsRevision: saved.hospitalContactsRevision };
  }
  return next;
}

export async function writeWebState(
  key: string,
  state: AppState,
  change?: (state: AppState) => AppState,
  replaceUnreadable = false,
): Promise<AppState> {
  const write = () => {
    // AsyncStorage web uses this same localStorage key. Keep the read and write
    // together so neither a visit nor a clinic selection is lost to a stale tab.
    const raw = window.localStorage.getItem(key);
    let base = state;
    if (raw !== null) {
      try { base = mergeNewerVisitData(state, validateLoadedState(JSON.parse(raw))); }
      catch (error) { if (!replaceUnreadable) throw error; }
    }
    const next = change ? change(base) : base;
    window.localStorage.setItem(key, JSON.stringify(next));
    return next;
  };
  return window.navigator.locks ? window.navigator.locks.request(key, write) : write();
}

export function onWebVisitDataChanged(key: string, accept: (saved: AppState) => void) {
  const listener = (event: StorageEvent) => {
    if (event.storageArea !== window.localStorage || event.key !== key || !event.newValue) return;
    try { accept(validateLoadedState(JSON.parse(event.newValue))); }
    catch { /* A malformed write in another tab cannot replace local records. */ }
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
