import { describe, expect, it } from 'vitest';
import {
  activeAlerts,
  deriveAlerts,
  dismissAlert,
  dismissForClosedApp,
  expireAlerts,
  hashString,
  mergeAlerts,
  sortAlerts,
} from '../../src/domain/alerts';
import type { Alert, Application } from '../../src/shared/types';
import { DAY, T0, entry, makeAnalysis, makeApp, makeEmail } from '../helpers';

const NOW = T0 + 2 * DAY;
const FUTURE = new Date(NOW + 3 * DAY).toISOString();
const acme = makeApp('app-1', 'Acme', 'Software Engineer', [entry('applied', T0)]);

const derive = (analysis = makeAnalysis(), applicationId: string | null = 'app-1', applications: Record<string, Application> = { 'app-1': acme }) =>
  deriveAlerts({ analysis, email: makeEmail(), applications, applicationId, now: NOW });

const alert = (id: string, extra: Partial<Alert> = {}): Alert => ({
  id,
  type: 'upcoming_event',
  company: 'Acme',
  companyKey: 'acme',
  firmKnown: true,
  title: 't',
  source: { threadId: 't', subject: 's', messageKey: 'k' },
  state: 'active',
  createdAt: T0,
  ...extra,
});

describe('hashString', () => {
  it('is deterministic and varies with input', () => {
    expect(hashString('a')).toBe(hashString('a'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});

describe('deriveAlerts: events (R9.1)', () => {
  it('creates an alert for a future event linked to the application', () => {
    const [a, ...rest] = derive(
      makeAnalysis({ emailKind: 'interview_invite', upcomingEvents: [{ type: 'interview', title: 'Onsite', startsAt: FUTURE }] }),
    );
    expect(rest).toHaveLength(0);
    expect(a).toMatchObject({
      type: 'upcoming_event',
      company: 'Acme',
      companyKey: 'acme',
      applicationId: 'app-1',
      firmKnown: true,
      title: 'Onsite',
      startsAt: Date.parse(FUTURE),
      state: 'active',
      createdAt: NOW,
    });
  });

  it('ignores past events, null or unparsable times', () => {
    const analysis = makeAnalysis({
      upcomingEvents: [
        { type: 'interview', title: 'Past', startsAt: new Date(NOW - DAY).toISOString() },
        { type: 'deadline', title: 'No time', startsAt: null },
        { type: 'other', title: 'Junk', startsAt: 'next tuesday-ish' },
      ],
    });
    expect(derive(analysis)).toEqual([]);
  });

  it('gives a default title when the event has none', () => {
    const [a] = derive(makeAnalysis({ upcomingEvents: [{ type: 'assessment', title: '  ', startsAt: FUTURE }] }));
    expect(a?.title).toBe('Assessment');
  });

  it('produces the same id for the same event and different ids for different events (R9.9)', () => {
    const ev = { type: 'interview' as const, title: 'Call', startsAt: FUTURE };
    const a1 = derive(makeAnalysis({ upcomingEvents: [ev] }))[0]!;
    const a2 = derive(makeAnalysis({ upcomingEvents: [{ ...ev, title: 'Different title' }] }))[0]!;
    const a3 = derive(makeAnalysis({ upcomingEvents: [{ ...ev, type: 'assessment' }] }))[0]!;
    expect(a1.id).toBe(a2.id);
    expect(a1.id).not.toBe(a3.id);
  });

  it('produces nothing for emails that are not job related', () => {
    expect(derive(makeAnalysis({ emailKind: 'not_job_related', upcomingEvents: [{ type: 'other', title: 'x', startsAt: FUTURE }] }))).toEqual([]);
  });

  it('omits applicationId when the email was not filed under an application', () => {
    const [a] = derive(makeAnalysis({ upcomingEvents: [{ type: 'deadline', title: 'd', startsAt: FUTURE }] }), null, {});
    expect(a).toBeDefined();
    expect(a).not.toHaveProperty('applicationId');
    expect(a?.firmKnown).toBe(false);
  });
});

describe('deriveAlerts: new opportunities (R9.2–R9.3)', () => {
  const opp = makeAnalysis({
    emailKind: 'new_opportunity',
    status: null,
    opportunities: [
      { title: 'Staff Engineer', location: 'Remote' },
      { title: ' ', location: null },
    ],
  });

  it('creates one alert per titled opportunity and marks a tracked firm as known', () => {
    const alerts = derive(opp, null);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'new_opportunity', title: 'Staff Engineer', location: 'Remote', firmKnown: true });
    expect(alerts[0]).not.toHaveProperty('startsAt');
  });

  it('marks an untracked firm as unknown', () => {
    const alerts = derive({ ...opp, company: 'Globex' }, null);
    expect(alerts[0]?.firmKnown).toBe(false);
  });

  it('recognizes a known firm by shared employer domain', () => {
    const withDomain = { 'app-1': { ...acme, senderDomains: ['acme.com'] } };
    const alerts = deriveAlerts({
      analysis: { ...opp, company: 'Acme Careers' },
      email: makeEmail(),
      applications: withDomain,
      applicationId: null,
      now: NOW,
    });
    expect(alerts[0]?.firmKnown).toBe(true);
  });

  it('falls back to the sender name when the company is unknown', () => {
    const alerts = derive({ ...opp, company: null }, null, {});
    expect(alerts[0]?.company).toBe('Acme Recruiting');
  });

  it('does not create opportunity alerts for other email kinds', () => {
    expect(derive(makeAnalysis({ opportunities: [{ title: 'X', location: null }] }))).toEqual([]);
  });
});

describe('mergeAlerts', () => {
  it('adds new alerts and keeps existing ones untouched (dismissed stays dismissed)', () => {
    const dismissed = alert('a', { state: 'dismissed' });
    const merged = mergeAlerts({ a: dismissed }, [alert('a'), alert('b')]);
    expect(merged['a']?.state).toBe('dismissed');
    expect(Object.keys(merged).sort()).toEqual(['a', 'b']);
  });
});

describe('expireAlerts (R9.7)', () => {
  it('moves elapsed active events to past and leaves others alone', () => {
    const alerts = {
      old: alert('old', { startsAt: NOW - 1 }),
      soon: alert('soon', { startsAt: NOW + 1 }),
      gone: alert('gone', { startsAt: NOW - 1, state: 'dismissed' }),
      opp: alert('opp', { type: 'new_opportunity' }),
    };
    const out = expireAlerts(alerts, NOW);
    expect(out['old']?.state).toBe('past');
    expect(out['soon']?.state).toBe('active');
    expect(out['gone']?.state).toBe('dismissed');
    expect(out['opp']?.state).toBe('active');
    expect(alerts.old.state).toBe('active'); // input untouched
  });
});

describe('dismissForClosedApp (R9.10)', () => {
  const alerts = {
    mine: alert('mine', { applicationId: 'app-1', startsAt: NOW + DAY }),
    other: alert('other', { applicationId: 'app-2', startsAt: NOW + DAY }),
    opp: alert('opp', { type: 'new_opportunity', applicationId: 'app-1' }),
  };

  it.each(['rejected', 'withdrawn'] as const)('dismisses that application\'s open events when %s', (status) => {
    const out = dismissForClosedApp(alerts, { ...acme, status });
    expect(out['mine']?.state).toBe('dismissed');
    expect(out['other']?.state).toBe('active');
    expect(out['opp']?.state).toBe('active');
  });

  it('does nothing for open applications', () => {
    expect(dismissForClosedApp(alerts, { ...acme, status: 'interview_scheduled' })).toBe(alerts);
  });
});

describe('unchanged inputs keep their identity (avoids needless storage writes)', () => {
  it('returns the same object when nothing changes', () => {
    const alerts = { a: alert('a', { startsAt: NOW + DAY }) };
    expect(expireAlerts(alerts, NOW)).toBe(alerts);
    expect(mergeAlerts(alerts, [alert('a')])).toBe(alerts);
    expect(mergeAlerts(alerts, [])).toBe(alerts);
    expect(dismissForClosedApp(alerts, { ...acme, status: 'rejected' })).toBe(alerts); // app-1 owns no alerts here
  });
});

describe('dismissAlert and activeAlerts', () => {
  it('dismisses one alert and lists only active ones', () => {
    const alerts = { a: alert('a'), b: alert('b') };
    const out = dismissAlert(alerts, 'a');
    expect(activeAlerts(out).map((x) => x.id)).toEqual(['b']);
    expect(dismissAlert(out, 'missing')).toBe(out);
  });
});

describe('sortAlerts (R9.4)', () => {
  it('orders known-firm opportunities, then events by time, then the rest newest first', () => {
    const list = [
      alert('unknownOpp', { type: 'new_opportunity', firmKnown: false, createdAt: T0 + 5 }),
      alert('late', { startsAt: NOW + 5 * DAY }),
      alert('knownOldOpp', { type: 'new_opportunity', createdAt: T0 }),
      alert('soon', { startsAt: NOW + DAY }),
      alert('knownNewOpp', { type: 'new_opportunity', createdAt: T0 + 9 }),
      alert('unknownOldOpp', { type: 'new_opportunity', firmKnown: false, createdAt: T0 }),
    ];
    expect(sortAlerts(list).map((a) => a.id)).toEqual([
      'knownNewOpp',
      'knownOldOpp',
      'soon',
      'late',
      'unknownOpp',
      'unknownOldOpp',
    ]);
  });

  it('does not mutate its input', () => {
    const list = [alert('b', { startsAt: 2 }), alert('a', { startsAt: 1 })];
    sortAlerts(list);
    expect(list.map((a) => a.id)).toEqual(['b', 'a']);
  });
});
