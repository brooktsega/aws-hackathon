// Service worker entry. Listeners are registered synchronously at top level (MV3 requirement).
import { STORAGE_KEYS } from '../shared/constants';
import { ensureSweepAlarm, handleAlarm, refresh, sweep } from './alarms';
import type { AlarmDeps } from './alarms';
import { removeViewState } from './extract';
import { openOrFocusDashboard } from '../shared/open-dashboard';
import { createHandlers } from './handlers';
import { registerRouter } from './router';
import { createStore } from './storage';

const store = createStore(chrome.storage.local);
const alarmDeps: AlarmDeps = {
  store,
  alarms: chrome.alarms,
  notifications: chrome.notifications,
  action: chrome.action,
  iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
  now: () => Date.now(),
};

// Runs on every worker start: keep storage out of reach of content scripts (R10.6).
void store.restrictAccess();

/** Initialize data, then (re)register the sweep, reminders, and badge. */
async function boot(): Promise<void> {
  await store.migrate();
  await ensureSweepAlarm(alarmDeps.alarms);
  await sweep(alarmDeps);
  await refresh(alarmDeps);
}

chrome.runtime.onInstalled.addListener(() => {
  // Clicking the toolbar icon opens the side panel (R1.6).
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void boot();
});
chrome.runtime.onStartup.addListener(() => void boot());

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeViewState(chrome.storage.session, tabId);
});

chrome.alarms.onAlarm.addListener((alarm) => void handleAlarm(alarmDeps, alarm));

// Alerts changed (saved, dismissed, deleted): re-plan reminders and update the badge.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && STORAGE_KEYS.alerts in changes) void refresh(alarmDeps);
});

chrome.notifications.onClicked.addListener((notificationId) => {
  void openOrFocusDashboard();
  void chrome.notifications.clear(notificationId);
});

registerRouter(createHandlers(store));
