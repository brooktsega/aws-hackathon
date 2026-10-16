import { describe, expect, it, vi } from 'vitest';
import {
  alertAlarmName,
  ensureSweepAlarm,
  handleAlarm,
  planAlarms,
  refresh,
  sweep,
  SWEEP_ALARM,
  syncAlarms,
  updateBadge,
} from '../../src/background/alarms';
import type { AlarmDeps, AlarmsApi } from '../../src/background/alarms';
import { createStore } from '../../src/background/storage';
import { ALERT_LEAD_MS, STORAGE_KEYS } from '../../src/shared/constants';
import type { Alert } from '../../src/shared/types';
import { createMemoryArea } from '../chrome-stub';
import { DAY, T0 } from '../helpers';

const NOW = T0;
const HOUR = 60 * 60 * 1000;

const alert = (id: string, extra: Partial<Alert> = {}): Alert => ({
  id, type: 'upcoming_event', company: 'Acme', companyKey: 'acme', firmKnown: true, title: 'Interview',
  startsAt: NOW + 3 * DAY, source: { threadId: 't', subject: 's', messageKey: 'k' }, state: 'active', createdAt: NOW, ...extra,
});

function fakeAlarms(initial: { name: string; scheduledTime: number }[] = []) {
  const store = new Map(initial.map((a) => [a.name, a.scheduledTime]));
  const api = {
    getAll: vi.fn(async () => [...store].map(([name, scheduledTime]) => ({ name, scheduledTime }))),
    get: vi.fn(async (name: string) => (store.has(name) ? { name } : undefined)),
    create: vi.fn(async (name: string, info: { when?: number; delayInMinutes?: number }) => {
      store.set(name, info.when ?? NOW + (info.delayInMinutes ?? 0) * 60_000);
    }),
    clear: vi.fn(async (name: string) => store.delete(name)),
  } satisfies AlarmsApi;
  return { api, store };
}

function setup(alerts: Alert[], alarmInitial: { name: string; scheduledTime: number }[] = []) {
  const area = createMemoryArea({ [STORAGE_KEYS.alerts]: Object.fromEntries(alerts.map((a) => [a.id, a])) });
  const fake = fakeAlarms(alarmInitial);
  const notifications = { create: vi.fn(async () => 'id') };
  const action = { setBadgeText: vi.fn(async () => undefined), setBadgeBackgroundColor: vi.fn(async () => undefined) };
  let now = NOW;
  const deps: AlarmDeps = { store: createStore(area), alarms: fake.api, notifications, action, iconUrl: 'icon.png', now: () => now };
  return { deps, area, fake, notifications, action, setNow: (t: number) => (now = t) };
}

const stored = (area: ReturnType<typeof createMemoryArea>) => area.data[STORAGE_KEYS.alerts] as Record<string, Alert>;

describe('planAlarms (R9.5)', () => {
  it('schedules a reminder 24 hours before each active future event', () => {
    const plan = planAlarms([alert('a')], NOW);
    expect(plan).toEqual([{ name: 'alert:a', when: NOW + 3 * DAY - ALERT_LEAD_MS }]);
  });

  it('fires almost immediately when the event is already inside 24 hours', () => {
    const [p] = planAlarms([alert('a', { startsAt: NOW + 5 * HOUR })], NOW);
    expect(p!.when).toBeGreaterThan(NOW);
    expect(p!.when).toBeLessThanOrEqual(NOW + 2_000);
  });

  it.each([
    ['dismissed', { state: 'dismissed' as const }],
    ['past', { state: 'past' as const }],
    ['already notified', { notifiedAt: NOW - 1 }],
    ['elapsed', { startsAt: NOW - 1 }],
    ['an opportunity', { type: 'new_opportunity' as const }],
  ])('skips %s alerts', (_name, extra) => {
    expect(planAlarms([alert('a', extra)], NOW)).toEqual([]);
  });
});

describe('syncAlarms', () => {
  it('creates missing alarms, clears stale ones, and leaves unrelated alarms alone', async () => {
    const { api, store } = fakeAlarms([
      { name: 'alert:stale', scheduledTime: NOW + DAY },
      { name: SWEEP_ALARM, scheduledTime: NOW + 60_000 },
    ]);
    await syncAlarms(api, [alert('a')], NOW);
    expect([...store.keys()].sort()).toEqual(['alert:a', SWEEP_ALARM].sort());
    expect(api.clear).toHaveBeenCalledWith('alert:stale');
    expect(api.clear).not.toHaveBeenCalledWith(SWEEP_ALARM);
  });

  it('is idempotent: a second sync creates nothing', async () => {
    const { api } = fakeAlarms();
    await syncAlarms(api, [alert('a')], NOW);
    api.create.mockClear();
    await syncAlarms(api, [alert('a')], NOW);
    expect(api.create).not.toHaveBeenCalled();
  });

  it('moves an alarm whose event time changed', async () => {
    const { api, store } = fakeAlarms([{ name: 'alert:a', scheduledTime: NOW + 2 * DAY }]);
    await syncAlarms(api, [alert('a', { startsAt: NOW + 5 * DAY })], NOW);
    expect(store.get('alert:a')).toBe(NOW + 4 * DAY);
  });

  it('clears the alarm when an alert is dismissed', async () => {
    const { api, store } = fakeAlarms([{ name: 'alert:a', scheduledTime: NOW + 2 * DAY }]);
    await syncAlarms(api, [alert('a', { state: 'dismissed' })], NOW);
    expect(store.size).toBe(0);
  });
});

describe('ensureSweepAlarm (R9.7)', () => {
  it('creates a repeating sweep once', async () => {
    const { api } = fakeAlarms();
    await ensureSweepAlarm(api);
    await ensureSweepAlarm(api);
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create).toHaveBeenCalledWith(SWEEP_ALARM, { delayInMinutes: 1, periodInMinutes: 30 });
  });
});

describe('updateBadge (R9.8)', () => {
  it('shows the count of active alerts and clears the badge at zero', async () => {
    const action = { setBadgeText: vi.fn(async () => undefined), setBadgeBackgroundColor: vi.fn(async () => undefined) };
    await updateBadge(action, [alert('a'), alert('b'), alert('c', { state: 'dismissed' }), alert('d', { state: 'past' })]);
    expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: '2' });
    await updateBadge(action, [alert('c', { state: 'dismissed' })]);
    expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });
});

describe('sweep (R9.7)', () => {
  it('marks elapsed events as past and does nothing when none elapsed', async () => {
    const t = setup([alert('old', { startsAt: NOW + HOUR }), alert('later')]);
    await sweep(t.deps);
    expect(t.area.setCalls).toHaveLength(0);
    t.setNow(NOW + 2 * HOUR);
    await sweep(t.deps);
    expect(stored(t.area)['old']!.state).toBe('past');
    expect(stored(t.area)['later']!.state).toBe('active');
  });
});

describe('handleAlarm: reminders (R9.5)', () => {
  it('notifies once, records notifiedAt, and does not notify again', async () => {
    const t = setup([alert('a', { startsAt: NOW + 5 * HOUR })]);
    await handleAlarm(t.deps, { name: alertAlarmName('a') });
    expect(t.notifications.create).toHaveBeenCalledTimes(1);
    const [id, options] = t.notifications.create.mock.calls[0] as unknown as [string, { title: string; message: string; iconUrl: string }];
    expect(id).toBe('alert:a');
    expect(options.title).toBe('Coming up: Interview');
    expect(options.message).toContain('Acme');
    expect(options.iconUrl).toBe('icon.png');
    expect(stored(t.area)['a']!.notifiedAt).toBe(NOW);

    await handleAlarm(t.deps, { name: alertAlarmName('a') });
    expect(t.notifications.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['dismissed', { state: 'dismissed' as const }],
    ['past', { state: 'past' as const }],
    ['elapsed', { startsAt: NOW - 1 }],
  ])('does not notify for a %s alert', async (_name, extra) => {
    const t = setup([alert('a', extra)]);
    await handleAlarm(t.deps, { name: alertAlarmName('a') });
    expect(t.notifications.create).not.toHaveBeenCalled();
  });

  it('ignores alarms for alerts that no longer exist and unknown alarms', async () => {
    const t = setup([]);
    await handleAlarm(t.deps, { name: alertAlarmName('gone') });
    await handleAlarm(t.deps, { name: 'something-else' });
    expect(t.notifications.create).not.toHaveBeenCalled();
  });

  it('runs the sweep and refreshes the badge on the sweep alarm', async () => {
    const t = setup([alert('old', { startsAt: NOW + HOUR }), alert('later')]);
    t.setNow(NOW + 2 * HOUR);
    await handleAlarm(t.deps, { name: SWEEP_ALARM });
    expect(stored(t.area)['old']!.state).toBe('past');
    expect(t.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
  });
});

describe('refresh', () => {
  it('registers alarms and the badge from stored alerts, without writing storage', async () => {
    const t = setup([alert('a'), alert('b', { state: 'dismissed' })]);
    await refresh(t.deps);
    expect([...t.fake.store.keys()]).toEqual(['alert:a']);
    expect(t.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
    expect(t.area.setCalls).toHaveLength(0); // no write, so storage.onChanged cannot loop
  });
});
