// Content script (mail.google.com only). Read-only: it answers EXTRACT_EMAIL
// requests from the service worker and reports the Gmail view state. It makes no
// network requests and does not touch chrome.storage (R2.8).
import type { MessageRequest } from '../shared/messages';
import { parseEmail } from './gmail-parser';
import { startViewTracker } from './view-tracker';

chrome.runtime.onMessage.addListener((message: MessageRequest, _sender, sendResponse) => {
  if (message?.type !== 'EXTRACT_EMAIL') return false;
  sendResponse(parseEmail(document, location.href));
  return false; // answered synchronously
});

startViewTracker({
  doc: document,
  win: window,
  send: (message) => {
    // The extension may have been reloaded under this page; ignore a dead context.
    try {
      void chrome.runtime.sendMessage(message).catch(() => undefined);
    } catch {
      /* extension context invalidated */
    }
  },
});
