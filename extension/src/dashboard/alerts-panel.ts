// Dashboard alerts column: active alerts, then past ones (R9.4, R9.6, R9.7).
import { activeAlerts, sortAlerts } from '../domain/alerts';
import type { Alert } from '../shared/types';
import { alertHeadline } from '../sidepanel/alerts-list';
import { h, render } from '../ui/dom';

export function renderAlertsPanel(container: Element, alerts: readonly Alert[], options: { now: number; onDismiss(id: string): void }): void {
  const byId = Object.fromEntries(alerts.map((a) => [a.id, a]));
  const active = sortAlerts(activeAlerts(byId));
  const past = alerts.filter((a) => a.state === 'past').sort((a, b) => (b.startsAt ?? b.createdAt) - (a.startsAt ?? a.createdAt));

  const item = (a: Alert, dismissable: boolean) => {
    const { title, detail } = alertHeadline(a, options.now);
    return h('li', { className: 'alert-item' },
      h('div', null,
        h('div', { className: 'alert-title' }, title),
        h('div', { className: 'small muted' }, detail),
        a.type === 'new_opportunity' && a.firmKnown ? h('span', { className: 'chip chip-neutral' }, 'Firm you’ve applied to') : null),
      dismissable ? h('button', { type: 'button', className: 'btn', 'aria-label': `Dismiss: ${title}`, on: { click: () => options.onDismiss(a.id) } }, 'Dismiss') : null);
  };
  const list = (items: Alert[], dismissable: boolean) =>
    h('ul', { style: 'list-style:none;margin:0;padding:0' }, ...items.map((a) => item(a, dismissable)));

  render(container,
    h('h2', null, 'Alerts'),
    active.length ? list(active, true) : h('p', { className: 'muted small' }, 'No upcoming events or new opportunities right now.'),
    past.length ? h('details', null, h('summary', null, `Past (${past.length})`), list(past, false)) : null);
}
