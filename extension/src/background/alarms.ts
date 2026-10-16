// Reminders, past-event sweep, and the toolbar badge (R9.5, R9.7, R9.8, design §9).
// All of it is derived from the stored alerts, so it is re-computed whenever they change
// and re-registered on startup (alarms can be cleared when the browser restarts).
import { activeAlerts, expireAlerts } from '../domain/alerts';
import { ALERT_LEAD_MS, ALERT_SWEEP_MINUTES } from '../shared/constants';
import type { Alert } from '../shared/types';
import { formatDateTime } from '../ui/format';
import type { Store } from './storage';

export const ALERT_ALARM_PREFIX = 'alert:';
export const SWEEP_ALARM = 'sweep';
/** Never schedule in the past or inside the same tick. */
const MIN_DELAY_MS = 1_000;

export interface AlarmsApi {
  getAll(): Promise<{ name: string; scheduledTime: number }[]>;
  get(name: string): Promise<{ name: string } | undefined>;
  create(name: string, info: { when?: number; periodInMinutes?: number; delayInMinutes?: number }): Promise<void> | void;
  clear(name: string): Promise<boolean>;
}

export interface NotificationsApi {
  create(id: string, options: { type: 'basic'; iconUrl: string; title: string; message: string; priority?: number }): Promise<string> | void;
}

export interface ActionApi {
  setBadgeText(details: { text: string }): Promise<void> | void;
  setBadgeBackgroundColor(details: { color: string }): Promise<void> | void;
}

export interface AlarmDeps {
  store: Store;
  alarms: AlarmsApi;
  notifications: NotificationsApi;
  action: ActionApi;
  iconUrl: string;
  now(): number;
}

export const alertAlarmName = (alertId: string): string => `${ALERT_ALARM_PREFIX}${alertId}`;

export interface PlannedAlarm {
  name: string;
  when: number;
}

/** One reminder per active, un-notified, future event: 24 hours ahead, or immediately if already inside that window. */
export function planAlarms(alerts: readonly Alert[], now: number): PlannedAlarm[] {
  return alerts
    .filter((a) => a.type === 'upcoming_event' && a.state === 'active' && a.notifiedAt === undefined && a.startsAt !== undefined && a.startsAt > now)
    .map((a) => ({ name: alertAlarmName(a.id), when: Math.max(now + MIN_DELAY_MS, (a.startsAt as number) - ALERT_LEAD_MS) }));
}

/** Makes the registered alert alarms match the plan: clears stale ones, adds or moves the rest. */
export async function syncAlarms(api: AlarmsApi, alerts: readonly Alert[], now: number): Promise<void> {
  const planned = new Map(planAlarms(alerts, now).map((p) => [p.name, p.when]));
  const existing = (await api.getAll()).filter((a) => a.name.startsWith(ALERT_ALARM_PREFIX));
  const have = new Map(existing.map((a) => [a.name, a.scheduledTime]));

  for (const name of have.keys()) if (!planned.has(name)) await api.clear(name);
  for (const [name, when] of planned) {
    // Only an alarm at the wrong time is replaced; one already inside the 24h window is left alone.
    const current = have.get(name);
    if (current === undefined || (current > now && Math.abs(current - when) > 60_000 && when > now + MIN_DELAY_MS)) {
      await api.create(name, { when });
    }
  }
}

export async function ensureSweepAlarm(api: AlarmsApi): Promise<void> {
  if (await api.get(SWEEP_ALARM)) return;
  await api.create(SWEEP_ALARM, { delayInMinutes: 1, periodInMinutes: ALERT_SWEEP_MINUTES });
}

/** Toolbar badge: number of active (undismissed, not past) alerts (R9.8). */
export async function updateBadge(action: ActionApi, alerts: readonly Alert[]): Promise<void> {
  const count = activeAlerts(Object.fromEntries(alerts.map((a) => [a.id, a]))).length;
  await action.setBadgeText({ text: count > 0 ? String(count) : '' });
  if (count > 0) await action.setBadgeBackgroundColor({ color: '#0b57d0' });
}

/** Marks elapsed events as past (R9.7). Writes nothing when nothing elapsed. */
export async function sweep(deps: AlarmDeps): Promise<void> {
  const now = deps.now();
  await deps.store.transaction((state) => {
    const alerts = expireAlerts(state.alerts, now);
    return { ok: true, state: alerts === state.alerts ? state : { ...state, alerts }, result: undefined };
  });
}

/** Re-registers alarms and the badge from storage. Safe to call as often as needed. */
export async function refresh(deps: AlarmDeps): Promise<void> {
  const { alerts } = await deps.store.load();
  const list = Object.values(alerts);
  await syncAlarms(deps.alarms, list, deps.now());
  await updateBadge(deps.action, list);
}

/** Shows the reminder once (R9.5): re-checks the alert, notifies, records `notifiedAt`. */
async function remind(deps: AlarmDeps, alertId: string): Promise<void> {
  const now = deps.now();
  let alert: Alert | undefined;
  await deps.store.transaction((state) => {
    const a = state.alerts[alertId];
    if (!a || a.type !== 'upcoming_event' || a.state !== 'active' || a.notifiedAt !== undefined || a.startsAt === undefined || a.startsAt <= now) {
      return { ok: true, state, result: undefined };
    }
    alert = a;
    return { ok: true, state: { ...state, alerts: { ...state.alerts, [a.id]: { ...a, notifiedAt: now } } }, result: undefined };
  });
  if (!alert) return;
  const a: Alert = alert;
  await deps.notifications.create(alertAlarmName(a.id), {
    type: 'basic',
    iconUrl: deps.iconUrl,
    title: `Coming up: ${a.title}`,
    message: `${a.company} · ${formatDateTime(a.startsAt as number)}`,
    priority: 1,
  });
}

export async function handleAlarm(deps: AlarmDeps, alarm: { name: string }): Promise<void> {
  if (alarm.name === SWEEP_ALARM) {
    await sweep(deps);
    return refresh(deps);
  }
  if (alarm.name.startsWith(ALERT_ALARM_PREFIX)) {
    await remind(deps, alarm.name.slice(ALERT_ALARM_PREFIX.length));
    return refresh(deps);
  }
}
