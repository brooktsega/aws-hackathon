// Display formatting shared by the side panel and dashboard.
import { MS_PER_DAY } from '../shared/constants';

export function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** "today", "1 day ago", "12 days ago". */
export function formatDaysAgo(days: number): string {
  if (days <= 0) return 'today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/** "in 3 hours", "in 2 days", "now" for an upcoming time. */
export function formatUntil(epochMs: number, now: number): string {
  const ms = epochMs - now;
  if (ms <= 0) return 'now';
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours < 1) return 'in under an hour';
  if (hours < 48) return hours === 1 ? 'in 1 hour' : `in ${hours} hours`;
  const days = Math.round(ms / MS_PER_DAY);
  return `in ${days} days`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Days with at most one decimal, or an em dash when unknown. */
export function formatDays(days: number | null): string {
  if (days === null) return '—';
  const rounded = Math.round(days * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}
