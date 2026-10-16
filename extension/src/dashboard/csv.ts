// CSV export of the filtered table (R8.9). Company and role text comes from email,
// so cells that a spreadsheet would read as a formula are neutralized.
import type { Application } from '../shared/types';
import { daysSince } from '../domain/metrics';

const HEADER = ['Company', 'Role', 'Status', 'Applied', 'Applied date estimated', 'Days since applied', 'First response', 'Last update', 'Rejected'];

/** Quotes a cell when needed and defuses spreadsheet formulas (=, +, -, @, tab, CR at the start). */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const iso = (t: number | undefined): string => (t === undefined ? '' : new Date(t).toISOString());

export function toCsv(apps: readonly Application[], now: number): string {
  const rows = apps.map((a) => [
    a.company, a.role, a.status, iso(a.appliedAt), a.appliedAtEstimated ? 'yes' : 'no',
    String(daysSince(a.appliedAt, now)), iso(a.firstResponseAt), iso(a.lastUpdateAt), iso(a.rejectedAt),
  ]);
  return [HEADER, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** UTF-8 BOM so Excel detects the encoding. */
export const CSV_BOM = '﻿';

export function csvFilename(now: number): string {
  return `job-applications-${new Date(now).toISOString().slice(0, 10)}.csv`;
}

export function downloadCsv(csv: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([CSV_BOM, csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
