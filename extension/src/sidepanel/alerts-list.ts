// Alerts summary (R9.4, R9.6): the next few active alerts, known-firm opportunities first.
import { activeAlerts, sortAlerts } from '../domain/alerts';
import type { Alert } from '../shared/types';
import { h, render } from '../ui/dom';
import { formatDateTime, formatUntil } from '../ui/format';

export interface AlertsListOptions {
  limit?: number;
  now?: () => number;
  onDismiss(alertId: string): void;
}

/** Text shown for one alert, shared with the dashboard. */
export function alertHeadline(alert: Alert, now: number): { title: string; detail: string } {
  if (alert.type === 'upcoming_event') {
    const when = alert.startsAt !== undefined ? `${formatDateTime(alert.startsAt)} (${formatUntil(alert.startsAt, now)})` : 'time not given';
    return { title: `${alert.title} — ${alert.company}`, detail: when };
  }
  return {
    title: `New opportunity at ${alert.company}: ${alert.title}`,
    detail: alert.location ?? 'From an email you received',
  };
}

export function renderAlerts(container: Element, alerts: readonly Alert[], options: AlertsListOptions): void {
  const now = (options.now ?? Date.now)();
  const all = sortAlerts(activeAlerts(Object.fromEntries(alerts.map((a) => [a.id, a]))));
  const shown = options.limit ? all.slice(0, options.limit) : all;

  if (shown.length === 0) {
    render(container, h('p', { className: 'muted small' }, 'No upcoming events or new opportunities right now.'));
    return;
  }
  render(
    container,
    h('ul', { className: 'plain', style: 'list-style:none;margin:0;padding:0' }, ...shown.map((a) => {
      const { title, detail } = alertHeadline(a, now);
      return h('li', { className: 'alert-item' },
        h('div', null,
          h('div', { className: 'alert-title' }, title),
          h('div', { className: 'small muted' }, detail),
          a.type === 'new_opportunity' && a.firmKnown ? h('span', { className: 'chip chip-neutral' }, 'Firm you’ve applied to') : null),
        h('button', { type: 'button', className: 'btn', 'aria-label': `Dismiss: ${title}`, on: { click: () => options.onDismiss(a.id) } }, 'Dismiss'));
    })),
    options.limit && all.length > shown.length ? h('p', { className: 'small muted' }, `${all.length - shown.length} more in the dashboard.`) : null,
  );
}
