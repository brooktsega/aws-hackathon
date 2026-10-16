import type { AnalysisResult, Application, EmailMeta, Status, StatusEntry } from '../src/shared/types';
import { normalizeCompany, normalizeRole } from '../src/domain/normalize';
import { recompute } from '../src/domain/merge';

export const DAY = 24 * 60 * 60 * 1000;
export const T0 = Date.UTC(2026, 9, 1, 12, 0, 0); // 2026-10-01T12:00:00Z

export function makeEmail(overrides: Partial<EmailMeta> = {}): EmailMeta {
  return {
    subject: 'Your application',
    from: { name: 'Acme Recruiting', address: 'jobs@acme.com' },
    to: 'me@example.com',
    date: T0,
    threadId: 'thread-1',
    messageKey: 'key-1',
    ...overrides,
  };
}

export function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    emailKind: 'application_confirmation',
    company: 'Acme',
    role: 'Software Engineer',
    status: 'applied',
    confidence: 'high',
    evidence: 'Thanks for applying',
    upcomingEvents: [],
    opportunities: [],
    ...overrides,
  };
}

export function entry(status: Status, at: number, extra: Partial<StatusEntry> = {}): StatusEntry {
  return { status, at, source: 'email', ...extra };
}

export function makeApp(
  id: string,
  company: string,
  role: string,
  history: StatusEntry[],
  extra: Partial<Application> = {},
): Application {
  return recompute({
    id,
    company,
    companyKey: normalizeCompany(company),
    role,
    roleKey: normalizeRole(role),
    senderDomains: [],
    history,
    status: 'applied',
    appliedAt: 0,
    appliedAtEstimated: true,
    lastUpdateAt: 0,
    createdAt: T0,
    ...extra,
  });
}
