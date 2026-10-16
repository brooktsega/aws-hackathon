// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDashboard } from '../../src/dashboard/app';
import type { DashboardDeps } from '../../src/dashboard/app';
import type { MessageRequest } from '../../src/shared/messages';
import type { Alert, Application } from '../../src/shared/types';
import { DAY, T0, entry, makeApp } from '../helpers';

const NOW = T0 + 10 * DAY;
const flush = () => new Promise((r) => setTimeout(r, 0));

const acme = makeApp('a', 'Acme', 'Software Engineer', [entry('applied', T0)]);
const globex = makeApp('g', 'Globex', 'Data Analyst', [entry('applied', T0 + 2 * DAY), entry('screening', T0 + 6 * DAY)]);
const initech = makeApp('i', 'Initech', 'Product Manager', [entry('applied', T0 + DAY), entry('rejected', T0 + 8 * DAY, { threadId: 'FMfcgzQbcdefghij', subject: 'Update on your application' })]);
const alert: Alert = {
  id: 'al', type: 'upcoming_event', company: 'Globex', companyKey: 'globex', firmKnown: true, title: 'Interview', startsAt: NOW + DAY,
  source: { threadId: 't', subject: 's', messageKey: 'k' }, state: 'active', createdAt: NOW,
};

function setup(initial: { apps?: Application[]; alerts?: Alert[] } = {}) {
  let collections = { applications: initial.apps ?? [acme, globex, initech], alerts: initial.alerts ?? [alert] };
  const subscribers: (() => void)[] = [];
  const calls: MessageRequest[] = [];
  const unsubscribe = vi.fn();
  const download = vi.fn();
  const deps: DashboardDeps = {
    send: (async (req: MessageRequest) => (calls.push(req), { ok: true, data: undefined })) as never,
    readCollections: async () => collections,
    subscribeCollections: (cb) => (subscribers.push(cb), unsubscribe),
    now: () => NOW,
    download,
  };
  const dash = createDashboard(deps);
  document.body.replaceChildren(dash.element);
  return { dash, calls, download, unsubscribe, change: (c: typeof collections) => { collections = c; subscribers.forEach((cb) => cb()); } };
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const rows = () => Array.from(document.querySelectorAll('tbody tr')).map((r) => (r as HTMLElement).dataset.id);
const tile = (label: string) => document.querySelector(`.tile[aria-label="${label}"] .tile-value`)!.textContent;
const type = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(() => document.body.replaceChildren());

describe('dashboard', () => {
  it('shows metrics, charts, table, and alerts for the stored applications (R8.2–R8.4, R9.4)', async () => {
    setup();
    await flush();
    expect(tile('Applications')).toBe('3');
    expect(tile('Active')).toBe('2');
    expect(tile('Rejections')).toBe('1');
    expect(document.querySelectorAll('.chart svg')).toHaveLength(2);
    expect(rows()).toEqual(['i', 'g', 'a']); // default: most recently updated first
    expect(document.body.textContent).toContain('Interview — Globex');
    expect(document.querySelector('[role="status"]')!.textContent).toBe('Showing 3 of 3 applications');
  });

  it('filters by status, text, and date range, updating metrics and the table together (R8.6)', async () => {
    setup();
    await flush();
    type($('#f-status'), 'rejected');
    expect(rows()).toEqual(['i']);
    expect(tile('Applications')).toBe('1');
    type($('#f-status'), '');

    type($('#f-text'), 'ANALYST');
    expect(rows()).toEqual(['g']);
    type($('#f-text'), '');

    const day = (offset: number) => new Date(T0 + offset * DAY).toISOString().slice(0, 10);
    type($('#f-from'), day(1));
    expect(rows()).toEqual(['i', 'g']);
    type($('#f-to'), day(1));
    expect(rows()).toEqual(['i']);
    expect(document.querySelector('[role="status"]')!.textContent).toBe('Showing 1 of 3 applications');
  });

  it('clears all filters', async () => {
    setup();
    await flush();
    type($('#f-text'), 'zzz');
    expect(rows()).toEqual([]);
    expect(document.body.textContent).toContain('No applications match these filters.');
    (Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Clear filters') as HTMLButtonElement).click();
    expect(rows()).toHaveLength(3);
    expect($<HTMLInputElement>('#f-text').value).toBe('');
  });

  it('keeps focus in the search box while typing', async () => {
    setup();
    await flush();
    const search = $<HTMLInputElement>('#f-text');
    search.focus();
    type(search, 'a');
    expect(document.activeElement).toBe(search);
  });

  it('sorts when a header is clicked and flips direction on a second click (R8.5)', async () => {
    setup();
    await flush();
    const header = (label: string) => Array.from(document.querySelectorAll('th button')).find((b) => b.textContent!.startsWith(label)) as HTMLButtonElement;
    header('Company').click();
    expect(rows()).toEqual(['a', 'g', 'i']);
    header('Company').click();
    expect(rows()).toEqual(['i', 'g', 'a']);
    header('Applied').click();
    expect(rows()).toEqual(['a', 'i', 'g']);
  });

  it('opens the detail drawer with the timeline and closes it again (R8.7–R8.8)', async () => {
    setup();
    await flush();
    $('tr[data-id="i"]').click();
    const drawer = $('.drawer');
    expect(drawer.textContent).toContain('Initech');
    expect(drawer.textContent).toContain('Update on your application');
    expect(drawer.querySelector('a')!.getAttribute('href')).toBe('https://mail.google.com/mail/u/0/#all/FMfcgzQbcdefghij');
    (Array.from(drawer.querySelectorAll('button')).find((b) => b.textContent === 'Close') as HTMLButtonElement).click();
    expect(document.querySelector('.drawer')).toBeNull();
  });

  it('keeps the drawer open and focus stable across unrelated updates, and closes it if the application is deleted', async () => {
    const t = setup();
    await flush();
    $('tr[data-id="a"]').click();
    await flush(); // the drawer moves focus to its Close button on open
    const select = $<HTMLSelectElement>('#drawer-status');
    select.focus();
    t.change({ applications: [acme, globex, initech], alerts: [] }); // unrelated change
    await flush();
    expect(document.activeElement).toBe(document.querySelector('#drawer-status'));
    t.change({ applications: [globex, initech], alerts: [] });
    await flush();
    expect(document.querySelector('.drawer')).toBeNull();
  });

  it('sends status changes and alert dismissals through the worker', async () => {
    const t = setup();
    await flush();
    $('tr[data-id="a"]').click();
    const select = $<HTMLSelectElement>('#drawer-status');
    select.value = 'offer';
    select.dispatchEvent(new Event('change'));
    (Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Dismiss: Interview — Globex') as HTMLButtonElement).click();
    await flush();
    expect(t.calls).toContainEqual({ type: 'SET_STATUS_MANUAL', payload: { applicationId: 'a', status: 'offer' } });
    expect(t.calls).toContainEqual({ type: 'DISMISS_ALERT', payload: { alertId: 'al' } });
  });

  it('exports exactly the filtered, sorted rows as CSV (R8.9)', async () => {
    const t = setup();
    await flush();
    type($('#f-text'), 'o'); // Globex, Initech (contain "o")... and Acme? no
    (Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Export CSV') as HTMLButtonElement).click();
    expect(t.download).toHaveBeenCalledTimes(1);
    const [csv, filename] = t.download.mock.calls[0] as unknown as [string, string];
    expect(filename).toBe('job-applications-2026-10-11.csv');
    const lines = csv.trimEnd().split('\r\n');
    const shown = rows();
    expect(lines).toHaveLength(shown.length + 1);
    expect(lines.slice(1).map((l) => l.split(',')[0])).toEqual(shown.map((id) => ({ a: 'Acme', g: 'Globex', i: 'Initech' })[id as 'a']));
  });

  it('disables export when nothing is shown', async () => {
    setup({ apps: [] });
    await flush();
    expect($<HTMLButtonElement>('header button').disabled).toBe(true);
    expect(tile('Applications')).toBe('0');
  });

  it('refreshes from storage changes and unsubscribes on destroy (R6.5)', async () => {
    const t = setup({ apps: [acme], alerts: [] });
    await flush();
    expect(rows()).toEqual(['a']);
    t.change({ applications: [acme, globex], alerts: [] });
    await flush();
    expect(rows()).toHaveLength(2);
    t.dash.destroy();
    expect(t.unsubscribe).toHaveBeenCalled();
  });
});
