// Side panel composition: header, analyze section, Kanban, alerts, settings.
import { send as defaultSend } from '../shared/client';
import { ERROR_INFO } from '../shared/errors';
import type { Alert, Application, SettingsView, Status, ViewState } from '../shared/types';
import { activeAlerts } from '../domain/alerts';
import { h, render } from '../ui/dom';
import { renderAlerts } from './alerts-list';
import { createAnalyzeSection } from './analyze';
import { askDisclosure } from './disclosure';
import { renderKanban } from './kanban';
import { createSettingsView } from './settings';

export interface AppDeps {
  send: typeof defaultSend;
  readCollections(): Promise<{ applications: Application[]; alerts: Alert[] }>;
  subscribeCollections(onChange: () => void): () => void;
  readViewState(): Promise<ViewState | undefined>;
  watchViewState(onChange: () => void): () => void;
  openDashboard(): void;
  now?: () => number;
}

export interface App {
  element: HTMLElement;
  destroy(): void;
}

export function createApp(deps: AppDeps): App {
  const { send } = deps;
  const element = h('div', { className: 'app' });
  let view: 'home' | 'settings' = 'home';
  let settings: SettingsView = { hasKey: false, model: '', disclosureAccepted: false };
  let viewState: ViewState | undefined;
  let applications: Application[] = [];
  let alerts: Alert[] = [];

  const openSettings = (): void => { view = 'settings'; draw(); };
  const goHome = (): void => { view = 'home'; draw(); };

  const analyze = createAnalyzeSection({ send, askDisclosure, openSettings });
  const boardHost = h('div', { 'aria-live': 'polite' });
  const alertsHost = h('div');
  const status = h('p', { className: 'small notice notice-error', role: 'alert', hidden: true });

  const report = (r: { ok: boolean; error?: { code: keyof typeof ERROR_INFO; message: string } }): void => {
    status.hidden = r.ok;
    status.textContent = r.ok ? '' : r.error!.code === 'INVALID_REQUEST' ? r.error!.message : ERROR_INFO[r.error!.code].message;
  };

  function drawCollections(): void {
    renderKanban(boardHost, applications, {
      setStatus: async (applicationId, s: Status) => report(await send({ type: 'SET_STATUS_MANUAL', payload: { applicationId, status: s } })),
      edit: async (applicationId, fields) => report(await send({ type: 'UPDATE_APPLICATION', payload: { applicationId, fields } })),
      remove: async (applicationId) => report(await send({ type: 'DELETE_APPLICATION', payload: { applicationId } })),
    }, deps.now ? { now: deps.now } : {});
    renderAlerts(alertsHost, alerts, {
      limit: 3,
      ...(deps.now ? { now: deps.now } : {}),
      onDismiss: async (alertId) => report(await send({ type: 'DISMISS_ALERT', payload: { alertId } })),
    });
  }

  function draw(): void {
    const count = activeAlerts(Object.fromEntries(alerts.map((a) => [a.id, a]))).length;
    const header = h('header', { className: 'app-header' },
      h('h1', null, 'Job Tracker'),
      h('button', { type: 'button', className: 'btn', on: { click: deps.openDashboard } }, 'Dashboard'),
      h('button', { type: 'button', className: 'btn btn-icon', 'aria-label': 'Settings', on: { click: openSettings } }, '⚙'),
    );

    if (view === 'settings') {
      render(element, header, createSettingsView({
        send,
        onBack: goHome,
        onChanged: (s) => { settings = s; pushContext(); },
      }));
      return;
    }
    render(element, header, status, analyze.element,
      h('section', { className: 'section', 'aria-labelledby': 'board-title' },
        h('div', { className: 'section-title' }, h('h2', { id: 'board-title' }, 'Applications')), boardHost),
      h('section', { className: 'section', 'aria-labelledby': 'alerts-title' },
        h('div', { className: 'section-title' }, h('h2', { id: 'alerts-title' }, 'Alerts', count > 0 ? h('span', { className: 'badge', 'aria-label': `${count} active` }, String(count)) : null)), alertsHost));
    drawCollections();
  }

  function pushContext(): void {
    analyze.setContext({ hasKey: settings.hasKey, disclosureAccepted: settings.disclosureAccepted, view: viewState });
  }

  async function refreshCollections(): Promise<void> {
    ({ applications, alerts } = await deps.readCollections());
    if (view === 'home') draw();
  }
  async function refreshView(): Promise<void> {
    viewState = await deps.readViewState();
    pushContext();
  }
  async function refreshSettings(): Promise<void> {
    const r = await send({ type: 'GET_SETTINGS' });
    if (r.ok) settings = r.data;
    pushContext();
  }

  const unsubscribers = [deps.subscribeCollections(() => void refreshCollections()), deps.watchViewState(() => void refreshView())];
  draw();
  void Promise.all([refreshSettings(), refreshView(), refreshCollections()]);

  return { element, destroy: () => unsubscribers.forEach((u) => u()) };
}
