// Dashboard filter state -> domain Filters (R8.6).
import type { Filters } from '../domain/metrics';
import type { Status } from '../shared/types';

export interface FilterInputs {
  status: '' | Status;
  /** `YYYY-MM-DD` from an <input type="date">, or ''. */
  from: string;
  to: string;
  text: string;
}

export const EMPTY_FILTERS: FilterInputs = { status: '', from: '', to: '', text: '' };

/** A local-time date from `YYYY-MM-DD`; `endOfDay` makes the bound inclusive of that whole day. */
export function parseDateInput(value: string, endOfDay: boolean): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = endOfDay ? new Date(y, mo - 1, d, 23, 59, 59, 999) : new Date(y, mo - 1, d, 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) || date.getMonth() !== mo - 1 ? undefined : date.getTime();
}

export function toFilters(inputs: FilterInputs): Filters {
  const filters: Filters = {};
  if (inputs.status) filters.statuses = [inputs.status];
  const from = parseDateInput(inputs.from, false);
  const to = parseDateInput(inputs.to, true);
  if (from !== undefined) filters.from = from;
  if (to !== undefined) filters.to = to;
  if (inputs.text.trim() !== '') filters.text = inputs.text;
  return filters;
}
