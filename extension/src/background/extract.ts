// Service worker side of email extraction (R4.1, R12.3, design §4.3): find the
// active Gmail tab, ask its content script for the open email, and record the
// per-tab view state the content script reports (R2.9).
import { EXTRACT_TIMEOUT_MS } from '../shared/constants';
import type { MessageRequest } from '../shared/messages';
import type { AppError, EmailPayload, Result, ViewState } from '../shared/types';
import type { Handler } from './router';
import type { KeyValueArea } from './storage';

export interface ExtractDeps {
  queryActiveTab(): Promise<{ id?: number; url?: string } | undefined>;
  sendToTab(tabId: number, message: MessageRequest<'EXTRACT_EMAIL'>): Promise<unknown>;
  timeoutMs?: number;
}

export function chromeExtractDeps(): ExtractDeps {
  return {
    queryActiveTab: async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0],
    sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  };
}

const fail = (code: AppError['code'], message: string): Result<never> => ({ ok: false, error: { code, message } });

const RELOAD_MESSAGE = 'Could not reach Gmail on this tab. Reload the Gmail tab and try again.';

const isString = (v: unknown): v is string => typeof v === 'string';

function isEmailPayload(v: unknown): v is EmailPayload {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  const from = e.from as Record<string, unknown> | undefined;
  return (
    isString(e.subject) &&
    isString(e.to) &&
    isString(e.threadId) &&
    isString(e.messageKey) &&
    isString(e.bodyText) &&
    typeof e.date === 'number' &&
    typeof e.truncated === 'boolean' &&
    typeof from === 'object' &&
    from !== null &&
    isString(from.name) &&
    isString(from.address)
  );
}

/** Validates the content script's reply, which crosses a trust boundary. */
function parseReply(reply: unknown): Result<EmailPayload> {
  if (typeof reply !== 'object' || reply === null) return fail('CONTENT_SCRIPT_UNREACHABLE', RELOAD_MESSAGE);
  const r = reply as { ok?: unknown; data?: unknown; error?: { code?: unknown; message?: unknown } };
  if (r.ok === true) {
    return isEmailPayload(r.data) ? { ok: true, data: r.data } : fail('GMAIL_DOM_UNRECOGNIZED', 'Could not read this Gmail view.');
  }
  const code = r.error?.code;
  if (code === 'NO_EMAIL_OPEN') return fail('NO_EMAIL_OPEN', 'Open an email in Gmail first.');
  return fail('GMAIL_DOM_UNRECOGNIZED', 'Could not read this Gmail view.');
}

/** Extracts the open email from the active tab. Never throws. */
export async function extractActiveEmail(deps: ExtractDeps): Promise<Result<EmailPayload>> {
  let tab: Awaited<ReturnType<ExtractDeps['queryActiveTab']>>;
  try {
    tab = await deps.queryActiveTab();
  } catch {
    return fail('NO_EMAIL_OPEN', 'Open an email in Gmail first.');
  }
  // Only Gmail tabs expose their URL to us (host permission), so a missing URL means "not Gmail".
  if (tab?.id === undefined || !tab.url?.startsWith('https://mail.google.com/')) {
    return fail('NO_EMAIL_OPEN', 'Open an email in Gmail first.');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), deps.timeoutMs ?? EXTRACT_TIMEOUT_MS);
  });
  try {
    const reply = await Promise.race([deps.sendToTab(tab.id, { type: 'EXTRACT_EMAIL' }), timeout]);
    if (reply === 'timeout') return fail('CONTENT_SCRIPT_UNREACHABLE', RELOAD_MESSAGE);
    return parseReply(reply);
  } catch {
    // "Receiving end does not exist": the tab predates the extension or Gmail has not loaded the script.
    return fail('CONTENT_SCRIPT_UNREACHABLE', RELOAD_MESSAGE);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Per-tab view state (storage.session)

export const viewStateKey = (tabId: number): string => `view:${tabId}`;

const isViewState = (v: unknown): v is ViewState =>
  typeof v === 'object' && v !== null && typeof (v as ViewState).isThreadView === 'boolean';

export function createViewHandler(session: KeyValueArea): Handler<'VIEW_CHANGED'> {
  return async (payload, sender) => {
    const tabId = sender.tab?.id;
    if (tabId === undefined || !isViewState(payload)) {
      return fail('INVALID_REQUEST', 'Malformed view update.');
    }
    const state: ViewState = payload.threadId === undefined
      ? { isThreadView: payload.isThreadView }
      : { isThreadView: payload.isThreadView, threadId: String(payload.threadId) };
    await session.set({ [viewStateKey(tabId)]: state });
    return { ok: true, data: undefined };
  };
}

export async function removeViewState(session: KeyValueArea, tabId: number): Promise<void> {
  await session.remove(viewStateKey(tabId));
}
