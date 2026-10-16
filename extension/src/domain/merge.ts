// Application timeline derivation and the merge engine (R5, design §8). Pure functions.
import { EVIDENCE_MAX_CHARS, UNKNOWN_ROLE } from '../shared/constants';
import type {
  AnalysisResult,
  Application,
  EmailMeta,
  Status,
  StatusEntry,
} from '../shared/types';
import {
  companiesMatch,
  companyDomain,
  normalizeCompany,
  normalizeRole,
  rolesMatch,
} from './normalize';

/**
 * Re-derives every cached field from `history` (R5.4–R5.8). History is sorted
 * by email date; for equal dates the later-inserted entry wins.
 */
export function recompute(app: Application): Application {
  if (app.history.length === 0) return app;
  const history = app.history
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.at - b.entry.at || a.index - b.index)
    .map((x) => x.entry);

  const first = history[0] as StatusEntry;
  const last = history[history.length - 1] as StatusEntry;
  const applied = history.find((e) => e.status === 'applied');
  const firstResponse = history.find((e) => e.status !== 'applied');
  const rejected = history.find((e) => e.status === 'rejected');

  const next: Application = {
    ...app,
    history,
    status: last.status,
    appliedAt: applied ? applied.at : first.at,
    appliedAtEstimated: !applied,
    lastUpdateAt: last.at,
  };
  if (firstResponse) next.firstResponseAt = firstResponse.at;
  else delete next.firstResponseAt;
  if (rejected) next.rejectedAt = rejected.at;
  else delete next.rejectedAt;
  return next;
}

export interface MergeState {
  applications: Record<string, Application>;
  /** messageKey -> applicationId */
  processed: Record<string, string>;
}

export interface MergeResult extends MergeState {
  /** The Application that received the email, or null when nothing was recorded. */
  applicationId: string | null;
}

const latest = (apps: Application[]): Application | undefined =>
  apps.reduce<Application | undefined>(
    (best, a) => (best === undefined || a.lastUpdateAt > best.lastUpdateAt ? a : best),
    undefined,
  );

/**
 * Finds the Application an email belongs to: same company (by name, or by
 * shared employer domain) and a matching role. An unknown role on either side
 * is treated as a wildcard so that terse emails ("Thanks for applying to
 * Acme") still land on the right record (R5.1, R5.10).
 */
export function findMatchingApplication(
  apps: Application[],
  companyKey: string,
  senderDomains: readonly string[],
  roleKey: string,
): Application | undefined {
  const ref = { companyKey, senderDomains };
  const sameCompany = apps.filter((a) => companiesMatch(a, ref));
  if (roleKey === '') return latest(sameCompany);
  return (
    latest(sameCompany.filter((a) => rolesMatch(a.roleKey, roleKey))) ??
    latest(sameCompany.filter((a) => a.roleKey === ''))
  );
}

function removeEntriesFor(app: Application, messageKey: string): Application | null {
  const history = app.history.filter((e) => e.messageKey !== messageKey);
  if (history.length === app.history.length) return app;
  if (history.length === 0) return null;
  return recompute({ ...app, history });
}

/**
 * Records one analyzed email. Emails that report no status, or name no
 * company, change nothing. Saving the same email twice updates its single
 * history entry instead of adding another (R5.9).
 *
 * `analysis` must already include the user's edits from the result card.
 */
export function applyAnalysis(
  state: MergeState,
  analysis: AnalysisResult,
  email: EmailMeta,
  now: number,
  newId: () => string = () => crypto.randomUUID(),
): MergeResult {
  const companyName = analysis.company?.trim() ?? '';
  const companyKey = normalizeCompany(companyName);
  if (analysis.status === null || companyKey === '') {
    return { ...state, applicationId: null };
  }

  const roleText = analysis.role?.trim() ?? '';
  const roleKey = normalizeRole(roleText);
  const domain = companyDomain(email.from.address);
  const senderDomains = domain ? [domain] : [];

  const entry: StatusEntry = {
    status: analysis.status,
    at: email.date,
    source: 'email',
    messageKey: email.messageKey,
    threadId: email.threadId,
    subject: email.subject,
    evidence: analysis.evidence.slice(0, EVIDENCE_MAX_CHARS),
  };

  const applications = { ...state.applications };
  const target = findMatchingApplication(Object.values(applications), companyKey, senderDomains, roleKey);

  // The email may previously have been filed under a different application
  // (the user corrected the company or role): move it rather than duplicate it.
  const previousId = state.processed[email.messageKey];
  if (previousId !== undefined && previousId !== target?.id && applications[previousId]) {
    const trimmed = removeEntriesFor(applications[previousId], email.messageKey);
    if (trimmed) applications[previousId] = trimmed;
    else delete applications[previousId];
  }

  let saved: Application;
  if (target) {
    const upsert = target.history.some((e) => e.messageKey === email.messageKey)
      ? target.history.map((e) => (e.messageKey === email.messageKey ? entry : e))
      : [...target.history, entry];
    const upgradeRole = target.roleKey === '' && roleKey !== '';
    saved = recompute({
      ...target,
      history: upsert,
      role: upgradeRole ? roleText : target.role,
      roleKey: upgradeRole ? roleKey : target.roleKey,
      senderDomains: [...new Set([...target.senderDomains, ...senderDomains])],
    });
  } else {
    saved = recompute({
      id: newId(),
      company: companyName,
      companyKey,
      role: roleKey === '' ? UNKNOWN_ROLE : roleText,
      roleKey,
      senderDomains,
      history: [entry],
      status: entry.status,
      appliedAt: entry.at,
      appliedAtEstimated: true,
      lastUpdateAt: entry.at,
      createdAt: now,
    });
  }

  applications[saved.id] = saved;
  return {
    applications,
    processed: { ...state.processed, [email.messageKey]: saved.id },
    applicationId: saved.id,
  };
}

/** Status shown for a history entry added by drag-and-drop or the move menu (R7.4). */
export function manualEntry(status: Status, now: number): StatusEntry {
  return { status, at: now, source: 'manual' };
}
