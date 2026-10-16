// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/sidepanel/app';
import type { AppDeps } from '../../src/sidepanel/app';
import type { MessageRequest } from '../../src/shared/messages';
import type { Alert, Application, SettingsView, ViewState } from '../../src/shared/types';
import { DAY, T0, entry, makeApp } from '../helpers';

const flush = () => new Promise((r) => setTimeout(r, 0));
const NOW = T0 + 5 * DAY;

function setup(init: { settings?: SettingsView; view?: ViewState; apps?: Application[]; alerts?: Alert[] } = {}) {
  let settings = init.settings ?? { hasKey: true, keyLast4: '1234', model: 'm', disclosureAccepted: true };
  let view = init.view;
  let collections = { applications: init.apps ?? [], alerts: init.alerts ?? [] };
  const subscribers: (() => void)[] = [];
  const viewWatchers: (() => void)[] = [];
  const unsubscribe = vi.fn();
  const calls: MessageRequest[] = [];
  const send = vi.fn(async (req: MessageRequest) => {
    calls.push(req);
    if (req.type === 'GET_SETTINGS') return { ok: true, data: settings };
    return { ok: true, data: undefined };
  });
  const deps: AppDeps = {
    send: send as never,
    readCollections: async () => collections,
    subscribeCollections: (cb) => (subscribers.push(cb), unsubscribe),
    readViewState: async () => view,
    watchViewState: (cb) => (viewWatchers.push(cb), unsubscribe),
    openDashboard: vi.fn(),
    now: () => NOW,
  };
  const app = createApp(deps);
  document.body.replaceChildren(app.element);
  return {
    app, deps, calls, send, unsubscribe,
    setCollections: (c: typeof collections) => { collections = c; subscribers.forEach((cb) => cb()); },
    setView: (v: ViewState | undefined) => { view = v; viewWatchers.forEach((cb) => cb()); },
    setSettings: (s: SettingsView) => { settings = s; },
  };
}
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;

beforeEach(() => document.body.replaceChildren());

describe('side panel app', () => {
  it('renders the header, analyze section, board, and alerts', async () => {
    setup();
    await flush();
    expect(document.querySelector('h1')!.textContent).toBe('Job Tracker');
    expect(document.body.textContent).toContain('Analyze email');
    expect(document.body.textContent).toContain('Applications');
    expect(document.body.textContent).toContain('No applications yet');
    expect(document.body.textContent).toContain('No upcoming events');
  });

  it('enables Analyze only when a thread is open, and follows the active tab (R3.1–R3.2)', async () => {
    const t = setup({ view: { isThreadView: false } });
    await flush();
    expect(button('Analyze this email').disabled).toBe(true);
    t.setView({ isThreadView: true, threadId: 'T' });
    await flush();
    expect(button('Analyze this email').disabled).toBe(false);
  });

  it('asks for a key when none is configured (R3.3)', async () => {
    setup({ settings: { hasKey: false, model: 'm', disclosureAccepted: false }, view: { isThreadView: true, threadId: 'T' } });
    await flush();
    expect(button('Analyze this email').disabled).toBe(true);
    expect(document.body.textContent).toContain('Add your Anthropic API key');
  });

  it('shows applications from storage and updates live (R6.5, R7.3)', async () => {
    const t = setup();
    await flush();
    t.setCollections({ applications: [makeApp('a', 'Acme', 'SWE', [entry('applied', T0)])], alerts: [] });
    await flush();
    expect(document.querySelector('[data-column="applied"]')!.textContent).toContain('Acme');
    expect(document.body.textContent).toContain('5 days ago');
  });

  it('shows the alert count badge and dismisses alerts through the worker (R9.6, R9.8)', async () => {
    const alert: Alert = {
      id: 'al1', type: 'upcoming_event', company: 'Acme', companyKey: 'acme', firmKnown: true, title: 'Interview', startsAt: NOW + DAY,
      source: { threadId: 't', subject: 's', messageKey: 'k' }, state: 'active', createdAt: NOW,
    };
    const t = setup({ alerts: [alert] });
    await flush();
    expect(document.querySelector('.badge')!.textContent).toBe('1');
    button('Dismiss: Interview — Acme').click();
    await flush();
    expect(t.calls).toContainEqual({ type: 'DISMISS_ALERT', payload: { alertId: 'al1' } });
  });

  it('moves a card through the worker and shows failures', async () => {
    const t = setup({ apps: [makeApp('a', 'Acme', 'SWE', [entry('applied', T0)])] });
    await flush();
    (document.querySelector('.kcard-menu-btn') as HTMLButtonElement).click();
    (Array.from(document.querySelectorAll('[role="menuitem"]')).find((b) => b.textContent === 'Offer') as HTMLButtonElement).click();
    await flush();
    expect(t.calls).toContainEqual({ type: 'SET_STATUS_MANUAL', payload: { applicationId: 'a', status: 'offer' } });

    t.send.mockResolvedValueOnce({ ok: false, error: { code: 'STORAGE_WRITE_FAILED', message: 'x' } } as never);
    (document.querySelector('.kcard-menu-btn') as HTMLButtonElement).click();
    (Array.from(document.querySelectorAll('[role="menuitem"]')).find((b) => b.textContent === 'Offer') as HTMLButtonElement).click();
    await flush();
    expect(document.querySelector('[role="alert"]:not([hidden])')!.textContent).toContain("Couldn't save");
  });

  it('opens settings and comes back (R10)', async () => {
    const t = setup();
    await flush();
    button('Settings').click();
    await flush();
    expect(document.body.textContent).toContain('Anthropic API key');
    expect(document.body.textContent).not.toContain('Analyze email');
    button('Back').click();
    await flush();
    expect(document.body.textContent).toContain('Analyze email');
    expect(t.calls.filter((c) => c.type === 'GET_SETTINGS').length).toBeGreaterThanOrEqual(2);
  });

  it('opens the dashboard', async () => {
    const t = setup();
    await flush();
    button('Dashboard').click();
    expect(t.deps.openDashboard).toHaveBeenCalled();
  });

  it('unsubscribes on destroy', async () => {
    const t = setup();
    await flush();
    t.app.destroy();
    expect(t.unsubscribe).toHaveBeenCalledTimes(2);
  });
});
