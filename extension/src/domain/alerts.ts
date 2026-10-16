// Alert derivation, expiry, dismissal and ordering (R9, design §9). Pure functions.
import type {
  AnalysisResult,
  Alert,
  Application,
  EmailMeta,
} from '../shared/types';
import { hashString } from '../shared/hash';
import { companiesMatch, companyDomain, normalizeCompany, normalizeRole } from './normalize';

export { hashString };

export interface DeriveAlertsInput {
  /** The analysis as saved, including user edits. */
  analysis: AnalysisResult;
  email: EmailMeta;
  /** Applications after the merge, so the one just saved counts as a known firm. */
  applications: Record<string, Application>;
  /** The Application the email was filed under, if any. */
  applicationId: string | null;
  now: number;
}

const EVENT_TITLES = {
  interview: 'Interview',
  assessment: 'Assessment',
  deadline: 'Deadline',
  offer_expiry: 'Offer expires',
  other: 'Event',
} as const;

/**
 * Alerts produced by one saved email: future dated events (R9.1) and, for
 * new-opportunity emails, one alert per opportunity (R9.2). `firmKnown` is true
 * when the company matches a tracked Application (R9.3).
 */
export function deriveAlerts(input: DeriveAlertsInput): Alert[] {
  const { analysis, email, applications, applicationId, now } = input;
  if (analysis.emailKind === 'not_job_related') return [];

  const company = analysis.company?.trim() || email.from.name.trim() || 'Unknown company';
  const companyKey = normalizeCompany(company);
  const domain = companyDomain(email.from.address);
  const senderDomains = domain ? [domain] : [];
  const firmKnown =
    applicationId !== null ||
    Object.values(applications).some((a) => companiesMatch(a, { companyKey, senderDomains }));

  const source = { threadId: email.threadId, subject: email.subject, messageKey: email.messageKey };
  const alerts: Alert[] = [];

  for (const ev of analysis.upcomingEvents) {
    if (ev.startsAt === null) continue;
    const startsAt = Date.parse(ev.startsAt);
    if (Number.isNaN(startsAt) || startsAt <= now) continue;
    const alert: Alert = {
      id: hashString(`event|${companyKey}|${ev.type}|${startsAt}`),
      type: 'upcoming_event',
      company,
      companyKey,
      firmKnown,
      title: ev.title.trim() || EVENT_TITLES[ev.type],
      startsAt,
      source,
      state: 'active',
      createdAt: now,
    };
    if (applicationId) alert.applicationId = applicationId;
    alerts.push(alert);
  }

  if (analysis.emailKind === 'new_opportunity') {
    for (const op of analysis.opportunities) {
      const title = op.title.trim();
      if (title === '') continue;
      const alert: Alert = {
        id: hashString(`opportunity|${companyKey}|${normalizeRole(title)}`),
        type: 'new_opportunity',
        company,
        companyKey,
        firmKnown,
        title,
        source,
        state: 'active',
        createdAt: now,
      };
      if (op.location) alert.location = op.location;
      alerts.push(alert);
    }
  }
  return alerts;
}

/** Adds new alerts; an alert that already exists keeps its state, so dismissed ones stay dismissed (R9.9). */
export function mergeAlerts(existing: Record<string, Alert>, derived: Alert[]): Record<string, Alert> {
  const fresh = derived.filter((a) => !(a.id in existing));
  if (fresh.length === 0) return existing;
  const out = { ...existing };
  for (const alert of fresh) out[alert.id] = alert;
  return out;
}

/** Active events whose start time has passed become `past` (R9.7). */
export function expireAlerts(alerts: Record<string, Alert>, now: number): Record<string, Alert> {
  let out: Record<string, Alert> | null = null;
  for (const [id, a] of Object.entries(alerts)) {
    if (a.state === 'active' && a.type === 'upcoming_event' && a.startsAt !== undefined && a.startsAt <= now) {
      out ??= { ...alerts };
      out[id] = { ...a, state: 'past' };
    }
  }
  return out ?? alerts; // same reference when nothing changed, so no storage write happens
}

/** Once an application is rejected or withdrawn, its pending events no longer matter (R9.10). */
export function dismissForClosedApp(alerts: Record<string, Alert>, app: Application): Record<string, Alert> {
  if (app.status !== 'rejected' && app.status !== 'withdrawn') return alerts;
  let out: Record<string, Alert> | null = null;
  for (const [id, a] of Object.entries(alerts)) {
    if (a.state === 'active' && a.type === 'upcoming_event' && a.applicationId === app.id) {
      out ??= { ...alerts };
      out[id] = { ...a, state: 'dismissed' };
    }
  }
  return out ?? alerts;
}

export function dismissAlert(alerts: Record<string, Alert>, alertId: string): Record<string, Alert> {
  const a = alerts[alertId];
  if (!a || a.state === 'dismissed') return alerts;
  return { ...alerts, [alertId]: { ...a, state: 'dismissed' } };
}

export function activeAlerts(alerts: Record<string, Alert>): Alert[] {
  return Object.values(alerts).filter((a) => a.state === 'active');
}

const group = (a: Alert): number => {
  if (a.type === 'new_opportunity' && a.firmKnown) return 0;
  if (a.type === 'upcoming_event') return 1;
  return 2;
};

/** Known-firm opportunities first, then events soonest-first, then the rest newest-first (R9.4). */
export function sortAlerts(list: readonly Alert[]): Alert[] {
  return [...list].sort((a, b) => {
    const ga = group(a);
    const gb = group(b);
    if (ga !== gb) return ga - gb;
    if (ga === 1) return (a.startsAt ?? 0) - (b.startsAt ?? 0) || a.id.localeCompare(b.id);
    return b.createdAt - a.createdAt || a.id.localeCompare(b.id);
  });
}
