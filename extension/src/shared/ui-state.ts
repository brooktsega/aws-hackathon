// Read-only access to stored collections for extension pages. Pages never read the
// `settings` key (it holds the API key); they use GET_SETTINGS instead.
import { STORAGE_KEYS } from './constants';
import type { Alert, Application } from './types';

export interface Collections {
  applications: Application[];
  alerts: Alert[];
}

const asList = <T>(v: unknown): T[] =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (Object.values(v) as T[]) : [];

export async function readCollections(): Promise<Collections> {
  const raw = await chrome.storage.local.get([STORAGE_KEYS.applications, STORAGE_KEYS.alerts]);
  return {
    applications: asList<Application>(raw[STORAGE_KEYS.applications]),
    alerts: asList<Alert>(raw[STORAGE_KEYS.alerts]),
  };
}

/** Calls `onChange` whenever applications or alerts change (R6.5). Returns an unsubscribe function. */
export function subscribeCollections(onChange: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string): void => {
    if (area === 'local' && (STORAGE_KEYS.applications in changes || STORAGE_KEYS.alerts in changes)) onChange();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
