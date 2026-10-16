import { describe, expect, it } from 'vitest';
import { applyAnalysis, findMatchingApplication, recompute } from '../../src/domain/merge';
import type { MergeState } from '../../src/domain/merge';
import { UNKNOWN_ROLE } from '../../src/shared/constants';
import { DAY, T0, entry, makeAnalysis, makeApp, makeEmail } from '../helpers';

describe('recompute (R5.4–R5.8)', () => {
  it('derives fields from a single applied entry', () => {
    const app = makeApp('a', 'Acme', 'SWE', [entry('applied', T0)]);
    expect(app).toMatchObject({
      status: 'applied',
      appliedAt: T0,
      appliedAtEstimated: false,
      lastUpdateAt: T0,
    });
    expect(app.firstResponseAt).toBeUndefined();
    expect(app.rejectedAt).toBeUndefined();
  });

  it('follows the latest email date, not insertion order', () => {
    const app = makeApp('a', 'Acme', 'SWE', [
      entry('rejected', T0 + 10 * DAY),
      entry('applied', T0),
      entry('interview_scheduled', T0 + 5 * DAY),
    ]);
    expect(app.history.map((e) => e.status)).toEqual(['applied', 'interview_scheduled', 'rejected']);
    expect(app.status).toBe('rejected');
    expect(app.appliedAt).toBe(T0);
    expect(app.firstResponseAt).toBe(T0 + 5 * DAY);
    expect(app.rejectedAt).toBe(T0 + 10 * DAY);
    expect(app.lastUpdateAt).toBe(T0 + 10 * DAY);
  });

  it('estimates appliedAt when there is no applied entry (R5.7)', () => {
    const app = makeApp('a', 'Acme', 'SWE', [entry('interview_scheduled', T0 + DAY), entry('rejected', T0 + 3 * DAY)]);
    expect(app.appliedAt).toBe(T0 + DAY);
    expect(app.appliedAtEstimated).toBe(true);
  });

  it('keeps the earliest applied entry when there are several (R5.6)', () => {
    const app = makeApp('a', 'Acme', 'SWE', [entry('applied', T0 + DAY), entry('applied', T0)]);
    expect(app.appliedAt).toBe(T0);
  });

  it('uses the latest status even after a rejection (a later interview email)', () => {
    const app = makeApp('a', 'Acme', 'SWE', [
      entry('applied', T0),
      entry('rejected', T0 + DAY),
      entry('interview_scheduled', T0 + 2 * DAY),
    ]);
    expect(app.status).toBe('interview_scheduled');
    expect(app.rejectedAt).toBe(T0 + DAY);
  });

  it('lets the later-inserted entry win when dates tie', () => {
    const app = makeApp('a', 'Acme', 'SWE', [entry('applied', T0), entry('screening', T0)]);
    expect(app.status).toBe('screening');
  });

  it('clears stale derived fields when entries are removed', () => {
    const base = makeApp('a', 'Acme', 'SWE', [entry('applied', T0), entry('rejected', T0 + DAY)]);
    const after = recompute({ ...base, history: [entry('applied', T0)] });
    expect(after.rejectedAt).toBeUndefined();
    expect(after.firstResponseAt).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const history = [entry('rejected', T0 + DAY), entry('applied', T0)];
    const app = { ...makeApp('a', 'Acme', 'SWE', []), history };
    recompute(app);
    expect(history.map((e) => e.status)).toEqual(['rejected', 'applied']);
  });
});

const empty = (): MergeState => ({ applications: {}, processed: {} });
let counter = 0;
const ids = () => `id-${++counter}`;

describe('applyAnalysis (R5.1–R5.3, R5.9–R5.10)', () => {
  it('creates a new application', () => {
    const r = applyAnalysis(empty(), makeAnalysis(), makeEmail(), T0 + DAY, () => 'new-1');
    expect(r.applicationId).toBe('new-1');
    const app = r.applications['new-1']!;
    expect(app).toMatchObject({
      company: 'Acme',
      companyKey: 'acme',
      role: 'Software Engineer',
      status: 'applied',
      appliedAt: T0,
      appliedAtEstimated: false,
      createdAt: T0 + DAY,
      senderDomains: ['acme.com'],
    });
    expect(app.history).toHaveLength(1);
    expect(app.history[0]).toMatchObject({ source: 'email', messageKey: 'key-1', evidence: 'Thanks for applying' });
    expect(r.processed).toEqual({ 'key-1': 'new-1' });
  });

  it('appends to the existing application for the same company and role', () => {
    const first = applyAnalysis(empty(), makeAnalysis(), makeEmail(), T0, () => 'a1');
    const second = applyAnalysis(
      first,
      makeAnalysis({ company: 'Acme, Inc.', role: 'Sr. Software Engineer', status: 'screening' }),
      makeEmail({ messageKey: 'key-2', date: T0 + 3 * DAY }),
      T0 + 3 * DAY,
      ids,
    );
    // "Sr. Software Engineer" (3 tokens) vs "Software Engineer" (2 tokens) is below the threshold.
    expect(Object.keys(second.applications)).toHaveLength(2);

    const third = applyAnalysis(
      first,
      makeAnalysis({ company: 'ACME Inc', role: 'software engineer (R-1234)', status: 'screening' }),
      makeEmail({ messageKey: 'key-3', date: T0 + 3 * DAY }),
      T0 + 3 * DAY,
      ids,
    );
    expect(Object.keys(third.applications)).toEqual(['a1']);
    expect(third.applications['a1']!.history.map((e) => e.status)).toEqual(['applied', 'screening']);
    expect(third.applications['a1']!.status).toBe('screening');
  });

  it('creates separate applications for different roles at one company', () => {
    const first = applyAnalysis(empty(), makeAnalysis(), makeEmail(), T0, ids);
    const second = applyAnalysis(
      first,
      makeAnalysis({ role: 'Product Manager' }),
      makeEmail({ messageKey: 'key-2' }),
      T0,
      ids,
    );
    expect(Object.keys(second.applications)).toHaveLength(2);
  });

  it('orders history by email date even when analyzed out of order', () => {
    const rej = applyAnalysis(
      empty(),
      makeAnalysis({ status: 'rejected', emailKind: 'rejection' }),
      makeEmail({ messageKey: 'rej', date: T0 + 10 * DAY }),
      T0 + 20 * DAY,
      () => 'a1',
    );
    const applied = applyAnalysis(rej, makeAnalysis(), makeEmail({ messageKey: 'app', date: T0 }), T0 + 21 * DAY, ids);
    const app = applied.applications['a1']!;
    expect(app.history.map((e) => e.status)).toEqual(['applied', 'rejected']);
    expect(app.appliedAt).toBe(T0);
    expect(app.appliedAtEstimated).toBe(false);
    expect(app.status).toBe('rejected');
  });

  it('does not add a second entry when the same email is saved twice (R5.9)', () => {
    const once = applyAnalysis(empty(), makeAnalysis(), makeEmail(), T0, () => 'a1');
    const twice = applyAnalysis(once, makeAnalysis(), makeEmail(), T0 + DAY, ids);
    expect(twice.applications['a1']!.history).toHaveLength(1);
    expect(Object.keys(twice.applications)).toHaveLength(1);
  });

  it('updates the single entry when the same email is re-saved with a correction', () => {
    const once = applyAnalysis(empty(), makeAnalysis({ status: 'screening' }), makeEmail(), T0, () => 'a1');
    const fixed = applyAnalysis(once, makeAnalysis({ status: 'interview_scheduled' }), makeEmail(), T0, ids);
    expect(fixed.applications['a1']!.history).toHaveLength(1);
    expect(fixed.applications['a1']!.status).toBe('interview_scheduled');
  });

  it('moves an email to another application when the user corrects the company', () => {
    const first = applyAnalysis(empty(), makeAnalysis({ company: 'Acme' }), makeEmail(), T0, () => 'a1');
    const moved = applyAnalysis(
      first,
      makeAnalysis({ company: 'Globex' }),
      makeEmail({ from: { name: 'x', address: 'a@globex.com' } }),
      T0,
      () => 'g1',
    );
    expect(moved.applications['a1']).toBeUndefined(); // emptied, so removed
    expect(moved.applications['g1']!.company).toBe('Globex');
    expect(moved.processed['key-1']).toBe('g1');
  });

  it('uses "Unknown role" when the role is null (R5.10)', () => {
    const r = applyAnalysis(empty(), makeAnalysis({ role: null }), makeEmail(), T0, () => 'a1');
    expect(r.applications['a1']).toMatchObject({ role: UNKNOWN_ROLE, roleKey: '' });
  });

  it('files a role-less email under the most recently updated application at that company', () => {
    let s = applyAnalysis(empty(), makeAnalysis({ role: 'Software Engineer' }), makeEmail(), T0, () => 'a1');
    s = applyAnalysis(s, makeAnalysis({ role: 'Product Manager' }), makeEmail({ messageKey: 'k2', date: T0 + 2 * DAY }), T0, () => 'a2');
    const r = applyAnalysis(
      s,
      makeAnalysis({ role: null, status: 'rejected', emailKind: 'rejection' }),
      makeEmail({ messageKey: 'k3', date: T0 + 5 * DAY }),
      T0,
      ids,
    );
    expect(r.applicationId).toBe('a2');
    expect(r.applications['a2']!.status).toBe('rejected');
  });

  it('upgrades an unknown-role application when a later email names the role', () => {
    const s = applyAnalysis(empty(), makeAnalysis({ role: null }), makeEmail(), T0, () => 'a1');
    const r = applyAnalysis(
      s,
      makeAnalysis({ role: 'Data Analyst', status: 'screening' }),
      makeEmail({ messageKey: 'k2', date: T0 + DAY }),
      T0,
      ids,
    );
    expect(Object.keys(r.applications)).toEqual(['a1']);
    expect(r.applications['a1']).toMatchObject({ role: 'Data Analyst', roleKey: 'data analyst' });
  });

  it('matches "Acme" and "Acme Labs" when they share an employer domain', () => {
    const s = applyAnalysis(empty(), makeAnalysis({ company: 'Acme' }), makeEmail(), T0, () => 'a1');
    const r = applyAnalysis(s, makeAnalysis({ company: 'Acme Labs', status: 'screening' }), makeEmail({ messageKey: 'k2', date: T0 + DAY }), T0, ids);
    expect(Object.keys(r.applications)).toEqual(['a1']);
  });

  it('ignores ATS sender domains when recording senderDomains', () => {
    const r = applyAnalysis(
      empty(),
      makeAnalysis(),
      makeEmail({ from: { name: 'Greenhouse', address: 'no-reply@us.greenhouse.io' } }),
      T0,
      () => 'a1',
    );
    expect(r.applications['a1']!.senderDomains).toEqual([]);
  });

  it('records nothing when status is null or company is missing', () => {
    const noStatus = applyAnalysis(empty(), makeAnalysis({ status: null }), makeEmail(), T0, ids);
    expect(noStatus).toEqual({ applications: {}, processed: {}, applicationId: null });
    const noCompany = applyAnalysis(empty(), makeAnalysis({ company: '  ' }), makeEmail(), T0, ids);
    expect(noCompany.applicationId).toBeNull();
  });

  it('truncates stored evidence and does not mutate its input state', () => {
    const state = empty();
    const r = applyAnalysis(state, makeAnalysis({ evidence: 'x'.repeat(500) }), makeEmail(), T0, () => 'a1');
    expect(r.applications['a1']!.history[0]!.evidence).toHaveLength(200);
    expect(state).toEqual({ applications: {}, processed: {} });
  });
});

describe('findMatchingApplication', () => {
  it('prefers the most recently updated of several role matches', () => {
    const older = makeApp('old', 'Acme', 'Software Engineer', [entry('applied', T0)]);
    const newer = makeApp('new', 'Acme', 'Software Engineer', [entry('applied', T0 + DAY)]);
    expect(findMatchingApplication([older, newer], 'acme', [], 'software engineer')?.id).toBe('new');
  });

  it('returns undefined when the company differs', () => {
    const app = makeApp('a', 'Acme', 'Software Engineer', [entry('applied', T0)]);
    expect(findMatchingApplication([app], 'globex', [], 'software engineer')).toBeUndefined();
  });
});
