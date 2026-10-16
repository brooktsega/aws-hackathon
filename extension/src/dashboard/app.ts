// Dashboard composition (R8): filters -> metrics, charts, table, alerts, drawer.
// State flows one way: stored collections + filters + sort -> render. The worker is the only writer.
import { send as defaultSend } from '../shared/client';
import { STATUSES, STATUS_LABELS } from '../shared/constants';
import { ERROR_INFO } from '../shared/errors';
import type { Alert, Application, Status } from '../shared/types';
import { computeMetrics, filterApplications, funnel, weeklyApplications } from '../domain/metrics';
import { h } from '../ui/dom';
import { renderAlertsPanel } from './alerts-panel';
import { renderFunnel, renderWeeklyChart } from './charts';
import { csvFilename, toCsv } from './csv';
import { createDrawer } from './drawer';
import { toFilters } from './filters';
import type { FilterInputs } from './filters';
import { DEFAULT_SORT, nextSort, renderTable, sortApplications } from './table';
import type { Sort } from './table';
import { renderTiles } from './tiles';

export interface DashboardDeps {
  send: typeof defaultSend;
  readCollections(): Promise<{ applications: Application[]; alerts: Alert[] }>;
  subscribeCollections(onChange: () => void): () => void;
  now(): number;
  download(csv: string, filename: string): void;
}

export interface Dashboard {
  element: HTMLElement;
  destroy(): void;
}

export function createDashboard(deps: DashboardDeps): Dashboard {
  const { send } = deps;
  let apps: Application[] = [];
  let alerts: Alert[] = [];
  let sort: Sort = DEFAULT_SORT;
  let selectedId: string | null = null;
  let drawn: { id: string; json: string; el: HTMLElement } | null = null;
  let lastFocus: HTMLElement | null = null;

  // --- Filter controls: built once, so typing never loses focus on re-render.
  const statusSelect = h('select', { id: 'f-status' }, h('option', { value: '' }, 'All statuses'),
    ...STATUSES.map((s) => h('option', { value: s }, STATUS_LABELS[s])));
  const from = h('input', { id: 'f-from', type: 'date' });
  const to = h('input', { id: 'f-to', type: 'date' });
  const text = h('input', { id: 'f-text', type: 'search', placeholder: 'Company or role', autocomplete: 'off' });
  const clear = h('button', { type: 'button', className: 'btn', on: { click: () => { statusSelect.value = ''; from.value = ''; to.value = ''; text.value = ''; update(); } } }, 'Clear filters');
  const exportBtn = h('button', { type: 'button', className: 'btn', on: { click: () => exportCsv() } }, 'Export CSV');
  const summary = h('p', { className: 'muted small', role: 'status', 'aria-live': 'polite' });
  const error = h('p', { className: 'notice notice-error', role: 'alert', hidden: true });

  const field = (label: string, control: HTMLElement) => h('div', { className: 'field' }, h('label', { for: control.id }, label), control);
  const filters = h('form', { className: 'filters', role: 'search', 'aria-label': 'Filters', on: { submit: (e) => e.preventDefault() } },
    field('Status', statusSelect), field('Applied from', from), field('Applied to', to), field('Search', text), clear);
  for (const el of [statusSelect, from, to, text]) {
    el.addEventListener('input', update);
    el.addEventListener('change', update);
  }

  // --- Result hosts.
  const tilesHost = h('section', { className: 'tiles', 'aria-label': 'Metrics' });
  const weeklyHost = h('div', { className: 'chart' });
  const funnelHost = h('div', { className: 'chart' });
  const tableHost = h('section', { 'aria-label': 'Applications' });
  const alertsHost = h('aside', { className: 'chart', 'aria-label': 'Alerts' });
  const drawerHost = h('div');

  const element = h('div', { className: 'dash' },
    h('header', { className: 'dash-header' }, h('h1', null, 'Job Tracker Dashboard'), exportBtn),
    error, filters, summary, tilesHost,
    h('div', { className: 'charts' }, weeklyHost, funnelHost),
    h('div', { className: 'dash-main' }, tableHost, alertsHost), drawerHost);

  const currentInputs = (): FilterInputs => ({ status: statusSelect.value as FilterInputs['status'], from: from.value, to: to.value, text: text.value });
  const visible = (): Application[] => sortApplications(filterApplications(apps, toFilters(currentInputs())), sort);

  const report = (r: { ok: boolean; error?: { code: keyof typeof ERROR_INFO; message: string } }): void => {
    error.hidden = r.ok;
    error.textContent = r.ok ? '' : r.error!.code === 'INVALID_REQUEST' ? r.error!.message : ERROR_INFO[r.error!.code].message;
  };

  function closeDrawer(): void {
    selectedId = null;
    drawn = null;
    drawerHost.replaceChildren();
    lastFocus?.focus?.();
  }

  function syncDrawer(): void {
    const app = selectedId ? apps.find((a) => a.id === selectedId) : undefined;
    if (!app) {
      if (selectedId) closeDrawer();
      return;
    }
    const json = JSON.stringify(app);
    if (drawn?.id === app.id && drawn.json === json) return; // unchanged: keep focus and scroll where they are
    const el = createDrawer(app, {
      onClose: closeDrawer,
      setStatus: async (id, status: Status) => report(await send({ type: 'SET_STATUS_MANUAL', payload: { applicationId: id, status } })),
      edit: async (id, fields) => report(await send({ type: 'UPDATE_APPLICATION', payload: { applicationId: id, fields } })),
      remove: async (id) => report(await send({ type: 'DELETE_APPLICATION', payload: { applicationId: id } })),
    });
    drawn = { id: app.id, json, el };
    drawerHost.replaceChildren(el);
  }

  function update(): void {
    const now = deps.now();
    const shown = visible();
    const filtered = filterApplications(apps, toFilters(currentInputs()));
    renderTiles(tilesHost, computeMetrics(filtered));
    renderWeeklyChart(weeklyHost, weeklyApplications(filtered, now));
    renderFunnel(funnelHost, funnel(filtered));
    renderTable(tableHost, shown, {
      now, sort,
      onSort: (key) => { sort = nextSort(sort, key); update(); },
      onOpen: (id) => { lastFocus = document.activeElement as HTMLElement | null; selectedId = id; syncDrawer(); },
    });
    renderAlertsPanel(alertsHost, alerts, {
      now,
      onDismiss: async (alertId) => report(await send({ type: 'DISMISS_ALERT', payload: { alertId } })),
    });
    summary.textContent = `Showing ${shown.length} of ${apps.length} application${apps.length === 1 ? '' : 's'}`;
    exportBtn.disabled = shown.length === 0;
    syncDrawer();
  }

  function exportCsv(): void {
    const now = deps.now();
    deps.download(toCsv(visible(), now), csvFilename(now));
  }

  async function load(): Promise<void> {
    ({ applications: apps, alerts } = await deps.readCollections());
    update();
  }

  const unsubscribe = deps.subscribeCollections(() => void load());
  update();
  void load();
  return { element, destroy: unsubscribe };
}
