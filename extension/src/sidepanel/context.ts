// Which Gmail view is the active tab showing? The content script reports it to the
// worker, which keeps it in storage.session (R2.9); the panel reads it from there.
import type { ViewState } from '../shared/types';
import { viewStateKey } from '../background/extract';

export async function readActiveViewState(): Promise<ViewState | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) return undefined;
  const key = viewStateKey(tab.id);
  const stored = (await chrome.storage.session.get(key))[key] as ViewState | undefined;
  return stored;
}

/** Calls `onChange` when the active tab or its Gmail view changes. Returns an unsubscribe function. */
export function watchActiveViewState(onChange: () => void): () => void {
  const onStorage = (changes: Record<string, unknown>, area: string): void => {
    if (area === 'session' && Object.keys(changes).some((k) => k.startsWith('view:'))) onChange();
  };
  chrome.tabs.onActivated.addListener(onChange);
  chrome.tabs.onUpdated.addListener(onChange);
  chrome.windows.onFocusChanged.addListener(onChange);
  chrome.storage.onChanged.addListener(onStorage);
  return () => {
    chrome.tabs.onActivated.removeListener(onChange);
    chrome.tabs.onUpdated.removeListener(onChange);
    chrome.windows.onFocusChanged.removeListener(onChange);
    chrome.storage.onChanged.removeListener(onStorage);
  };
}
