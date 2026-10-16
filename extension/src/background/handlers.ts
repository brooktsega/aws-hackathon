// Wires every message handler to its real dependencies. The service worker entry
// calls this once at top level; tests build handlers from their own dependencies instead.
import { createAnalyzeHandler } from './analyze';
import { createClaudeClient } from './claude';
import { chromeExtractDeps, createViewHandler, extractActiveEmail } from './extract';
import {
  createDeleteApplicationHandler,
  createDismissAlertHandler,
  createSaveAnalysisHandler,
  createSetStatusHandler,
  createUpdateApplicationHandler,
} from './persist';
import type { Handlers } from './router';
import {
  createDeleteAllDataHandler,
  createGetSettingsHandler,
  createSaveSettingsHandler,
  createTestConnectionHandler,
} from './settings';
import type { Store } from './storage';

export function createHandlers(store: Store): Handlers {
  const now = (): number => Date.now();
  const persist = { store, now };
  const settings = { store, createClient: createClaudeClient };
  const extractDeps = chromeExtractDeps();

  return {
    VIEW_CHANGED: createViewHandler(chrome.storage.session),
    ANALYZE_ACTIVE_EMAIL: createAnalyzeHandler({
      store,
      session: chrome.storage.session,
      extract: () => extractActiveEmail(extractDeps),
      createClient: createClaudeClient,
      now,
      timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    SAVE_ANALYSIS: createSaveAnalysisHandler(persist),
    SET_STATUS_MANUAL: createSetStatusHandler(persist),
    UPDATE_APPLICATION: createUpdateApplicationHandler(persist),
    DELETE_APPLICATION: createDeleteApplicationHandler(persist),
    DISMISS_ALERT: createDismissAlertHandler(persist),
    GET_SETTINGS: createGetSettingsHandler(settings),
    SAVE_SETTINGS: createSaveSettingsHandler(settings),
    TEST_CONNECTION: createTestConnectionHandler(settings),
    DELETE_ALL_DATA: createDeleteAllDataHandler(settings),
  };
}
