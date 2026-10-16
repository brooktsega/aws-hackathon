import { describe, expect, it } from 'vitest';
import {
  computeMetrics,
  daysSince,
  filterApplications,
  funnel,
  median,
  weeklyApplications,
} from '../../src/domain/metrics';
import { DAY, T0, entry, makeApp } from '../helpers';

// T0 is Thursday 2026-10-01; Monday of that week is 2026-09-28.
const MONDAY = Date.UTC(2026, 8, 28);

const applied = (id: string, company: string, offset = 0) =>
  makeApp(id, company, 'Software Engineer', [entry('applied', T0 + offset * DAY)]);

describe('median', () => {
  it('handles empty, odd, and even lengths', () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('daysSince', () => {
  it('floors whole days and never goes negative', () => {
    expect(daysSince(T0, T0 + 3.9 * DAY)).toBe(3);
    expect(daysSince(T0, T0 - DAY)).toBe(0);
  });
});

describe('filterApplications (R8.6)', () => {
  const apps = [
    makeApp('a', 'Acme', 'Backend Engineer', [entry('applied', T0)]),
    makeApp('b', 'Globex', 'Designer', [entry('applied', T0 + 10 * DAY), entry('rejected', T0 + 12 * DAY)]),
    makeApp('c', 'Initech', 'Engineer', [entry('applied', T0 + 20 * DAY), entry('screening', T0 + 21 * DAY)]),
  ];
  const ids = (f: Parameters<typeof filterApplications>[1]) => filterApplications(apps, f).map((a) => a.id);

  it('returns everything for empty filters', () => {
    expect(ids({})).toEqual(['a', 'b', 'c']);
    expect(ids({ statuses: [] })).toEqual(['a', 'b', 'c']);
  });

  it('filters by status', () => {
    expect(ids({ statuses: ['rejected'] })).toEqual(['b']);
    expect(ids({ statuses: ['applied', 'screening'] })).toEqual(['a', 'c']);
  });

  it('filters by inclusive applied-date range', () => {
    expect(ids({ from: T0 + 10 * DAY, to: T0 + 20 * DAY })).toEqual(['b', 'c']);
    expect(ids({ from: T0 + 11 * DAY })).toEqual(['c']);
    expect(ids({ to: T0 + 5 * DAY })).toEqual(['a']);
  });

  it('searches company and role case-insensitively', () => {
    expect(ids({ text: 'GLOBEX' })).toEqual(['b']);
    expect(ids({ text: 'engineer' })).toEqual(['a', 'c']);
    expect(ids({ text: '  ' })).toEqual(['a', 'b', 'c']);
  });

  it('combines filters', () => {
    expect(ids({ text: 'engineer', statuses: ['screening'] })).toEqual(['c']);
  });
});

describe('computeMetrics (R8.2)', () => {
  it('returns zeros and nulls for an empty set', () => {
    expect(computeMetrics([])).toEqual({
      total: 0,
      active: 0,
      responseRate: 0,
      medianDaysToResponse: null,
      medianDaysToRejection: null,
      rejections: 0,
      estimatedIncluded: 0,
    });
  });

  it('handles one fresh application', () => {
    expect(computeMetrics([applied('a', 'Acme')])).toMatchObject({
      total: 1,
      active: 1,
      responseRate: 0,
      medianDaysToResponse: null,
      rejections: 0,
    });
  });

  it('counts active, responses, rejections, and medians', () => {
    const apps = [
      applied('silent', 'A'),
      makeApp('screen', 'B', 'SWE', [entry('applied', T0), entry('screening', T0 + 4 * DAY)]),
      makeApp('rej1', 'C', 'SWE', [entry('applied', T0), entry('rejected', T0 + 10 * DAY)]),
      makeApp('rej2', 'D', 'SWE', [entry('applied', T0), entry('screening', T0 + 2 * DAY), entry('rejected', T0 + 20 * DAY)]),
      makeApp('offer', 'E', 'SWE', [entry('applied', T0), entry('offer', T0 + 30 * DAY)]),
      makeApp('out', 'F', 'SWE', [entry('applied', T0), entry('withdrawn', T0 + 3 * DAY)]),
    ];
    const m = computeMetrics(apps);
    expect(m.total).toBe(6);
    expect(m.active).toBe(2); // silent, screen
    expect(m.responseRate).toBeCloseTo(5 / 6);
    // response times: 4, 10, 2, 30, 3 -> median 4
    expect(m.medianDaysToResponse).toBe(4);
    // rejection times: 10, 20 -> 15
    expect(m.medianDaysToRejection).toBe(15);
    expect(m.rejections).toBe(2);
    expect(m.estimatedIncluded).toBe(0);
  });

  it('ignores estimated applied dates when precise values exist', () => {
    const precise = makeApp('p', 'A', 'SWE', [entry('applied', T0), entry('rejected', T0 + 10 * DAY)]);
    const estimated = makeApp('e', 'B', 'SWE', [entry('screening', T0), entry('rejected', T0 + 50 * DAY)]);
    expect(estimated.appliedAtEstimated).toBe(true);
    const m = computeMetrics([precise, estimated]);
    expect(m.medianDaysToRejection).toBe(10);
    expect(m.estimatedIncluded).toBe(0);
  });

  it('falls back to estimated values, and reports how many were used, when nothing is precise', () => {
    const estimated = makeApp('e', 'B', 'SWE', [entry('screening', T0), entry('rejected', T0 + 6 * DAY)]);
    const m = computeMetrics([estimated]);
    expect(m.medianDaysToRejection).toBe(6);
    expect(m.medianDaysToResponse).toBe(0);
    expect(m.estimatedIncluded).toBe(2);
  });
});

describe('funnel', () => {
  it('counts applications that ever reached each stage', () => {
    const apps = [
      applied('a', 'A'),
      makeApp('b', 'B', 'SWE', [entry('applied', T0), entry('screening', T0 + DAY), entry('rejected', T0 + 2 * DAY)]),
      makeApp('c', 'C', 'SWE', [entry('applied', T0), entry('interview_scheduled', T0 + DAY)]), // skipped screening
      makeApp('d', 'D', 'SWE', [entry('applied', T0), entry('offer', T0 + DAY)]),
    ];
    expect(funnel(apps)).toEqual([
      { stage: 'applied', count: 4 },
      { stage: 'screening', count: 3 },
      { stage: 'interview_scheduled', count: 2 },
      { stage: 'offer', count: 1 },
    ]);
  });

  it('returns zeros for no applications', () => {
    expect(funnel([]).map((s) => s.count)).toEqual([0, 0, 0, 0]);
  });
});

describe('weeklyApplications', () => {
  it('returns 12 oldest-first weekly buckets ending with the current week', () => {
    const buckets = weeklyApplications([], T0);
    expect(buckets).toHaveLength(12);
    expect(buckets[11]?.weekStart).toBe(MONDAY);
    expect(buckets[0]?.weekStart).toBe(MONDAY - 11 * 7 * DAY);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });

  it('buckets applications by UTC week and drops ones outside the window', () => {
    const apps = [
      applied('thisWeek1', 'A', 0),
      applied('thisWeek2', 'B', 2), // Saturday, same week
      applied('lastWeek', 'C', -4), // Sunday 2026-09-27 -> previous week
      applied('ancient', 'D', -365),
      applied('future', 'E', 30),
    ];
    const buckets = weeklyApplications(apps, T0);
    expect(buckets[11]?.count).toBe(2);
    expect(buckets[10]?.count).toBe(1);
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(3);
  });

  it('puts a Monday 00:00 application in its own week', () => {
    const mondayApp = makeApp('m', 'A', 'SWE', [entry('applied', MONDAY)]);
    expect(weeklyApplications([mondayApp], T0)[11]?.count).toBe(1);
  });
});
