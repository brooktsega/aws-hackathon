// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { alertHeadline, renderAlerts } from '../../src/sidepanel/alerts-list';
import type { Alert } from '../../src/shared/types';
import { DAY, T0 } from '../helpers';

const NOW = T0;
const alert = (id: string, extra: Partial<Alert> = {}): Alert => ({
  id, type: 'upcoming_event', company: 'Acme', companyKey: 'acme', firmKnown: true, title: 'Interview',
  startsAt: NOW + DAY, source: { threadId: 't', subject: 's', messageKey: 'k' }, state: 'active', createdAt: NOW, ...extra,
});

let host: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
});

describe('alertHeadline', () => {
  it('describes events and opportunities', () => {
    expect(alertHeadline(alert('a'), NOW).title).toBe('Interview — Acme');
    expect(alertHeadline(alert('a'), NOW).detail).toContain('in 24 hours');
    const opp = alert('b', { type: 'new_opportunity', title: 'Staff Engineer', location: 'Remote' });
    delete (opp as { startsAt?: number }).startsAt;
    expect(alertHeadline(opp, NOW)).toEqual({ title: 'New opportunity at Acme: Staff Engineer', detail: 'Remote' });
  });
});

describe('renderAlerts (R9.4, R9.6)', () => {
  it('shows an empty message when there are no active alerts', () => {
    renderAlerts(host, [alert('a', { state: 'dismissed' }), alert('b', { state: 'past' })], { onDismiss: vi.fn(), now: () => NOW });
    expect(host.textContent).toContain('No upcoming events');
  });

  it('lists known-firm opportunities first, then events by time', () => {
    const opp = alert('opp', { type: 'new_opportunity', title: 'PM', firmKnown: true });
    delete (opp as { startsAt?: number }).startsAt;
    renderAlerts(host, [alert('late', { title: 'Late', startsAt: NOW + 5 * DAY }), alert('soon', { title: 'Soon' }), opp], { onDismiss: vi.fn(), now: () => NOW });
    const titles = Array.from(host.querySelectorAll('.alert-title')).map((e) => e.textContent);
    expect(titles).toEqual(['New opportunity at Acme: PM', 'Soon — Acme', 'Late — Acme']);
    expect(host.textContent).toContain('Firm you’ve applied to');
  });

  it('limits the list and points to the dashboard for the rest', () => {
    const many = Array.from({ length: 5 }, (_, i) => alert(`a${i}`, { startsAt: NOW + (i + 1) * DAY }));
    renderAlerts(host, many, { limit: 3, onDismiss: vi.fn(), now: () => NOW });
    expect(host.querySelectorAll('.alert-item')).toHaveLength(3);
    expect(host.textContent).toContain('2 more in the dashboard');
  });

  it('dismisses an alert', () => {
    const onDismiss = vi.fn();
    renderAlerts(host, [alert('a')], { onDismiss, now: () => NOW });
    (host.querySelector('button') as HTMLButtonElement).click();
    expect(onDismiss).toHaveBeenCalledWith('a');
    expect(host.querySelector('button')!.getAttribute('aria-label')).toBe('Dismiss: Interview — Acme');
  });

  it('renders alert text as text, never markup (R11.5)', () => {
    renderAlerts(host, [alert('a', { title: '<img src=x onerror=alert(1)>', company: '<b>Evil</b>' })], { onDismiss: vi.fn(), now: () => NOW });
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('b')).toBeNull();
  });
});
