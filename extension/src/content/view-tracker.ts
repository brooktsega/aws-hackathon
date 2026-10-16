// Reports whether the tab is showing a conversation (R2.9). Sends VIEW_CHANGED
// only when the state actually changes, so Gmail's constant DOM churn stays cheap.
import type { MessageRequest } from '../shared/messages';
import type { ViewState } from '../shared/types';
import { getViewState } from './gmail-parser';

export interface ViewTrackerDeps {
  doc: Document;
  win: Window;
  send: (message: MessageRequest<'VIEW_CHANGED'>) => void;
  debounceMs?: number;
}

const sameState = (a: ViewState | null, b: ViewState): boolean =>
  a !== null && a.isThreadView === b.isThreadView && a.threadId === b.threadId;

/** Starts tracking. Returns a stop function (used by tests). */
export function startViewTracker({ doc, win, send, debounceMs = 300 }: ViewTrackerDeps): () => void {
  let last: ViewState | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const check = (): void => {
    const state = getViewState(doc, win.location.href);
    if (sameState(last, state)) return;
    last = state;
    send({ type: 'VIEW_CHANGED', payload: state });
  };

  const schedule = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(check, debounceMs);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(doc.body, { childList: true, subtree: true });
  win.addEventListener('hashchange', schedule);
  check();

  return () => {
    if (timer !== undefined) clearTimeout(timer);
    observer.disconnect();
    win.removeEventListener('hashchange', schedule);
  };
}
