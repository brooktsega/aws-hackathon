// Applications table: sorting and rendering (R8.4, R8.5, R8.7, R8.10).
import { STATUS_LABELS } from '../shared/constants';
import type { Application } from '../shared/types';
import { daysSince } from '../domain/metrics';
import { h, render } from '../ui/dom';
import { formatDate } from '../ui/format';

export type SortKey = 'company' | 'role' | 'status' | 'appliedAt' | 'daysSince' | 'lastUpdateAt' | 'rejectedAt';
export type SortDir = 'asc' | 'desc';
export interface Sort {
  key: SortKey;
  dir: SortDir;
}

export const DEFAULT_SORT: Sort = { key: 'lastUpdateAt', dir: 'desc' };

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'company', label: 'Company' },
  { key: 'role', label: 'Role' },
  { key: 'status', label: 'Status' },
  { key: 'appliedAt', label: 'Applied' },
  { key: 'daysSince', label: 'Days since applied' },
  { key: 'lastUpdateAt', label: 'Last update' },
  { key: 'rejectedAt', label: 'Rejected' },
];

const STATUS_ORDER = Object.keys(STATUS_LABELS);

/** Sorts a copy. Dates and numbers compare numerically; text ignores case; missing rejection dates always sort last. */
export function sortApplications(apps: readonly Application[], sort: Sort): Application[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const text = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: 'base' });
  return [...apps].sort((a, b) => {
    if (sort.key === 'rejectedAt') {
      if (a.rejectedAt === undefined || b.rejectedAt === undefined) {
        return a.rejectedAt === b.rejectedAt ? 0 : a.rejectedAt === undefined ? 1 : -1;
      }
      return sign * (a.rejectedAt - b.rejectedAt);
    }
    let result: number;
    switch (sort.key) {
      case 'company': result = text(a.company, b.company); break;
      case 'role': result = text(a.role, b.role); break;
      case 'status': result = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status); break;
      case 'appliedAt': result = a.appliedAt - b.appliedAt; break;
      case 'daysSince': result = b.appliedAt - a.appliedAt; break; // more days since = earlier applied
      case 'lastUpdateAt': result = a.lastUpdateAt - b.lastUpdateAt; break;
    }
    return sign * result || text(a.company, b.company) || a.id.localeCompare(b.id);
  });
}

/** Clicking the active column flips its direction; a new column starts ascending (R8.5). */
export function nextSort(current: Sort, key: SortKey): Sort {
  return current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
}

export interface TableOptions {
  now: number;
  sort: Sort;
  onSort(key: SortKey): void;
  onOpen(applicationId: string): void;
}

export function renderTable(container: Element, apps: readonly Application[], options: TableOptions): void {
  const head = h('tr', null, ...COLUMNS.map((c) => {
    const active = options.sort.key === c.key;
    const arrow = active ? (options.sort.dir === 'asc' ? '▲' : '▼') : '';
    return h('th', { scope: 'col', 'aria-sort': active ? (options.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
      h('button', { type: 'button', on: { click: () => options.onSort(c.key) } }, c.label, arrow ? h('span', { 'aria-hidden': 'true' }, arrow) : null));
  }));

  const rows = apps.map((a) => {
    const open = (): void => options.onOpen(a.id);
    return h('tr', { dataset: { id: a.id }, on: { click: open } },
      h('td', { className: 'wrap' }, h('button', { type: 'button', className: 'btn-link', on: { click: (e) => { e.stopPropagation(); open(); } } }, a.company)),
      h('td', { className: 'wrap' }, a.role),
      h('td', null, h('span', { className: 'chip', dataset: { status: a.status } }, STATUS_LABELS[a.status])),
      h('td', null, formatDate(a.appliedAt), a.appliedAtEstimated ? h('span', { className: 'muted small', title: 'Estimated: no application confirmation was found' }, ' (est.)') : null),
      h('td', null, String(daysSince(a.appliedAt, options.now))),
      h('td', null, formatDate(a.lastUpdateAt)),
      h('td', null, a.rejectedAt !== undefined ? formatDate(a.rejectedAt) : '—'));
  });

  render(container, h('div', { className: 'table-wrap' },
    h('table', { className: 'apps' }, h('thead', null, head), h('tbody', null, ...rows))),
    apps.length === 0 ? h('p', { className: 'empty' }, 'No applications match these filters.') : null);
}
