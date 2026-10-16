// Filters and dashboard metrics (R8.2–R8.4, R8.10, design §10). Pure functions.
// Weeks are UTC weeks starting Monday, so results do not depend on the machine's time zone.
import { MS_PER_DAY, WEEKLY_CHART_WEEKS } from '../shared/constants';
import type { Application, Status } from '../shared/types';

export interface Filters {
  /** Empty or undefined means "all statuses". */
  statuses?: readonly Status[];
  /** Inclusive bounds on `appliedAt`, epoch ms. */
  from?: number;
  to?: number;
  /** Case-insensitive substring of company or role. */
  text?: string;
}

export function filterApplications(apps: readonly Application[], filters: Filters): Application[] {
  const text = filters.text?.trim().toLowerCase() ?? '';
  return apps.filter((a) => {
    if (filters.statuses && filters.statuses.length > 0 && !filters.statuses.includes(a.status)) return false;
    if (filters.from !== undefined && a.appliedAt < filters.from) return false;
    if (filters.to !== undefined && a.appliedAt > filters.to) return false;
    if (text !== '' && !`${a.company} ${a.role}`.toLowerCase().includes(text)) return false;
    return true;
  });
}

/** Whole days between `appliedAt` and `now` (never negative). */
export function daysSince(appliedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - appliedAt) / MS_PER_DAY));
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export const FUNNEL_STAGES = ['applied', 'screening', 'interview_scheduled', 'offer'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export interface FunnelStep {
  stage: FunnelStage;
  count: number;
}

/**
 * How many applications ever reached each stage. Reaching a later stage counts
 * as having reached the earlier ones; every application counts as applied.
 */
export function funnel(apps: readonly Application[]): FunnelStep[] {
  const reached = apps.map((a) => {
    let best = 0;
    for (const e of a.history) {
      const i = (FUNNEL_STAGES as readonly string[]).indexOf(e.status);
      if (i > best) best = i;
    }
    return best;
  });
  return FUNNEL_STAGES.map((stage, i) => ({ stage, count: reached.filter((r) => r >= i).length }));
}

export interface WeekBucket {
  /** Epoch ms of Monday 00:00 UTC. */
  weekStart: number;
  count: number;
}

function weekStartUtc(t: number): number {
  const day = new Date(t);
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return midnight - sinceMonday * MS_PER_DAY;
}

/** Applications per week for the last `weeks` weeks, oldest first, including empty weeks. */
export function weeklyApplications(
  apps: readonly Application[],
  now: number,
  weeks: number = WEEKLY_CHART_WEEKS,
): WeekBucket[] {
  const thisWeek = weekStartUtc(now);
  const buckets: WeekBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) buckets.push({ weekStart: thisWeek - i * 7 * MS_PER_DAY, count: 0 });
  const first = (buckets[0] as WeekBucket).weekStart;
  for (const a of apps) {
    if (a.appliedAt < first || a.appliedAt >= thisWeek + 7 * MS_PER_DAY) continue;
    const bucket = buckets[Math.floor((weekStartUtc(a.appliedAt) - first) / (7 * MS_PER_DAY))];
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

export interface Metrics {
  total: number;
  /** Not rejected, withdrawn, or at the offer stage. */
  active: number;
  /** Share of applications with any response, 0–1. */
  responseRate: number;
  medianDaysToResponse: number | null;
  medianDaysToRejection: number | null;
  rejections: number;
  /** Applications whose applied date is an estimate and that fed a timing median. */
  estimatedIncluded: number;
}

const isActive = (a: Application): boolean =>
  a.status !== 'rejected' && a.status !== 'withdrawn' && a.status !== 'offer';

interface Timing {
  days: number;
  estimated: boolean;
}

/** Median of the timings, ignoring estimated ones when any precise value exists (design §10). */
function timingMedian(timings: Timing[]): { value: number | null; estimatedIncluded: number } {
  const precise = timings.filter((t) => !t.estimated);
  const used = precise.length > 0 ? precise : timings;
  return {
    value: median(used.map((t) => t.days)),
    estimatedIncluded: used.filter((t) => t.estimated).length,
  };
}

/** Metrics over an already-filtered list, so the tiles always match the table. */
export function computeMetrics(apps: readonly Application[]): Metrics {
  const responded = apps.filter((a) => a.firstResponseAt !== undefined);
  const rejected = apps.filter((a) => a.rejectedAt !== undefined);

  const response = timingMedian(
    responded.map((a) => ({
      days: Math.max(0, ((a.firstResponseAt as number) - a.appliedAt) / MS_PER_DAY),
      estimated: a.appliedAtEstimated,
    })),
  );
  const rejection = timingMedian(
    rejected.map((a) => ({
      days: Math.max(0, ((a.rejectedAt as number) - a.appliedAt) / MS_PER_DAY),
      estimated: a.appliedAtEstimated,
    })),
  );

  return {
    total: apps.length,
    active: apps.filter(isActive).length,
    responseRate: apps.length === 0 ? 0 : responded.length / apps.length,
    medianDaysToResponse: response.value,
    medianDaysToRejection: rejection.value,
    rejections: rejected.length,
    estimatedIncluded: response.estimatedIncluded + rejection.estimatedIncluded,
  };
}
