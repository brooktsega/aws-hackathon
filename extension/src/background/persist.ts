// Write-side handlers for applications and alerts (R5, R6, R7.4–R7.5, R9; design §8–9).
// Each handler is one storage transaction, so a failure leaves stored data unchanged.
import { dismissAlert, dismissForClosedApp, deriveAlerts, expireAlerts, mergeAlerts } from '../domain/alerts';
import { applyAnalysis, manualEntry, recompute } from '../domain/merge';
import { normalizeCompany, normalizeRole } from '../domain/normalize';
import { STATUSES, UNKNOWN_ROLE } from '../shared/constants';
import type { AnalysisPreview, AnalysisEdits, AppError, EmailMeta, Status } from '../shared/types';
import type { Handler } from './router';
import type { Store } from './storage';

export interface PersistDeps {
  store: Store;
  now(): number;
  newId?: () => string;
}

const bad = (message: string): { ok: false; error: AppError } => ({
  ok: false,
  error: { code: 'INVALID_REQUEST', message },
});

const isStatus = (v: unknown): v is Status => typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function isEmailMeta(v: unknown): v is EmailMeta {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  const from = e.from as Record<string, unknown> | undefined;
  return (
    typeof e.subject === 'string' && typeof e.to === 'string' && typeof e.threadId === 'string' &&
    isNonEmpty(e.messageKey) && typeof e.date === 'number' && Number.isFinite(e.date) &&
    typeof from === 'object' && from !== null && typeof from.name === 'string' && typeof from.address === 'string'
  );
}

function isEdits(v: unknown): v is AnalysisEdits {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return isStringOrNull(e.company) && isStringOrNull(e.role) && (e.status === null || isStatus(e.status));
}

export function createSaveAnalysisHandler({ store, now, newId }: PersistDeps): Handler<'SAVE_ANALYSIS'> {
  return async (payload) => {
    const preview = payload?.preview as AnalysisPreview | undefined;
    const edits = payload?.edits;
    if (!preview || !isEmailMeta(preview.email) || typeof preview.analysis !== 'object' || preview.analysis === null || !isEdits(edits)) {
      return bad('Malformed save request.');
    }
    if (edits.status !== null && !isNonEmpty(edits.company)) return bad('A company is required to save a status.');

    // Alerts come from what Claude found; the application record comes from what the user confirmed.
    const analysis = { ...preview.analysis, company: edits.company, role: edits.role, status: edits.status };
    const email = preview.email;
    const at = now();

    return store.transaction((state) => {
      const merged = applyAnalysis({ applications: state.applications, processed: state.processed }, analysis, email, at, newId);
      const derived = deriveAlerts({ analysis, email, applications: merged.applications, applicationId: merged.applicationId, now: at });

      let alerts = expireAlerts(mergeAlerts(state.alerts, derived), at);
      const saved = merged.applicationId ? merged.applications[merged.applicationId] : undefined;
      if (saved) alerts = dismissForClosedApp(alerts, saved);

      const processed =
        merged.applicationId === null ? { ...merged.processed, [email.messageKey]: '' } : merged.processed;
      return {
        ok: true,
        state: { ...state, applications: merged.applications, processed, alerts },
        result: { applicationId: merged.applicationId },
      };
    });
  };
}

export function createSetStatusHandler({ store, now }: PersistDeps): Handler<'SET_STATUS_MANUAL'> {
  return async (payload) => {
    if (!isNonEmpty(payload?.applicationId) || !isStatus(payload.status)) return bad('Malformed status change.');
    const { applicationId, status } = payload;
    const at = now();
    return store.transaction((state) => {
      const app = state.applications[applicationId];
      if (!app) return bad('That application no longer exists.');
      if (app.status === status) return { ok: true, state, result: undefined };
      const updated = recompute({ ...app, history: [...app.history, manualEntry(status, at)] });
      return {
        ok: true,
        state: {
          ...state,
          applications: { ...state.applications, [applicationId]: updated },
          alerts: dismissForClosedApp(state.alerts, updated),
        },
        result: undefined,
      };
    });
  };
}

export function createUpdateApplicationHandler({ store }: PersistDeps): Handler<'UPDATE_APPLICATION'> {
  return async (payload) => {
    const fields = payload?.fields;
    if (!isNonEmpty(payload?.applicationId) || typeof fields !== 'object' || fields === null) return bad('Malformed update.');
    const company = fields.company?.trim();
    const role = fields.role?.trim();
    if ((fields.company !== undefined && !company) || (fields.role !== undefined && !role)) {
      return bad('Company and role cannot be blank.');
    }
    return store.transaction((state) => {
      const app = state.applications[payload.applicationId];
      if (!app) return bad('That application no longer exists.');
      const next = { ...app };
      if (company) {
        next.company = company;
        next.companyKey = normalizeCompany(company);
      }
      if (role) {
        next.role = role;
        next.roleKey = role === UNKNOWN_ROLE ? '' : normalizeRole(role);
      }
      return {
        ok: true,
        state: { ...state, applications: { ...state.applications, [app.id]: next } },
        result: undefined,
      };
    });
  };
}

export function createDeleteApplicationHandler({ store }: PersistDeps): Handler<'DELETE_APPLICATION'> {
  return async (payload) => {
    if (!isNonEmpty(payload?.applicationId)) return bad('Malformed delete request.');
    const id = payload.applicationId;
    return store.transaction((state) => {
      if (!state.applications[id]) return { ok: true, state, result: undefined };
      const applications = Object.fromEntries(Object.entries(state.applications).filter(([appId]) => appId !== id));
      // Forget the app's emails so analyzing them again can recreate the record.
      const processed = Object.fromEntries(Object.entries(state.processed).filter(([, appId]) => appId !== id));
      const alerts = Object.fromEntries(Object.entries(state.alerts).filter(([, a]) => a.applicationId !== id));
      return { ok: true, state: { ...state, applications, processed, alerts }, result: undefined };
    });
  };
}

export function createDismissAlertHandler({ store }: PersistDeps): Handler<'DISMISS_ALERT'> {
  return async (payload) => {
    if (!isNonEmpty(payload?.alertId)) return bad('Malformed dismiss request.');
    return store.transaction((state) => {
      const alerts = dismissAlert(state.alerts, payload.alertId);
      return { ok: true, state: alerts === state.alerts ? state : { ...state, alerts }, result: undefined };
    });
  };
}
