// Claude output contract: the JSON schema sent to the API and the runtime
// validator that re-checks the response (R4.5, design §6.2). The schema is
// built from the same constants as the types, so the three cannot drift.
import {
  CONFIDENCE_LEVELS,
  EMAIL_KINDS,
  EVENT_TYPES,
  EVIDENCE_MAX_CHARS,
  NON_STATUS_EMAIL_KINDS,
  STATUSES,
} from '../shared/constants';
import type { AnalysisResult, AppError, Result } from '../shared/types';

// Nullable fields use anyOf, which structured outputs support; type arrays are not guaranteed to be.
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const;

export const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'emailKind',
    'company',
    'role',
    'status',
    'confidence',
    'evidence',
    'upcomingEvents',
    'opportunities',
  ],
  properties: {
    emailKind: { type: 'string', enum: [...EMAIL_KINDS] },
    company: nullableString,
    role: nullableString,
    status: { anyOf: [{ type: 'string', enum: [...STATUSES] }, { type: 'null' }] },
    confidence: { type: 'string', enum: [...CONFIDENCE_LEVELS] },
    evidence: { type: 'string' },
    upcomingEvents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'title', 'startsAt'],
        properties: {
          type: { type: 'string', enum: [...EVENT_TYPES] },
          title: { type: 'string' },
          startsAt: nullableString,
        },
      },
    },
    opportunities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'location'],
        properties: {
          title: { type: 'string' },
          location: nullableString,
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Validator

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

/** Returns a description of the first problem found, or null if `obj` has exactly `keys`. */
function keyProblem(obj: Rec, keys: readonly string[], path: string): string | null {
  for (const k of keys) if (!(k in obj)) return `${path}.${k} is missing`;
  for (const k of Object.keys(obj)) if (!keys.includes(k)) return `${path}.${k} is not allowed`;
  return null;
}

function invalid(message: string): Result<never> {
  const error: AppError = { code: 'INVALID_MODEL_OUTPUT', message };
  return { ok: false, error };
}

/**
 * Strictly validates an untrusted value against the analysis contract: exact
 * keys, correct types, enum members only. Does not normalize; see sanitizeAnalysis.
 */
export function validateAnalysis(value: unknown): Result<AnalysisResult> {
  if (!isRecord(value)) return invalid('analysis is not an object');
  const top = keyProblem(value, ANALYSIS_SCHEMA.required, 'analysis');
  if (top) return invalid(top);

  if (!isOneOf(EMAIL_KINDS, value.emailKind)) return invalid('analysis.emailKind is not allowed');
  if (!isStringOrNull(value.company)) return invalid('analysis.company must be a string or null');
  if (!isStringOrNull(value.role)) return invalid('analysis.role must be a string or null');
  if (value.status !== null && !isOneOf(STATUSES, value.status)) {
    return invalid('analysis.status is not allowed');
  }
  if (!isOneOf(CONFIDENCE_LEVELS, value.confidence)) {
    return invalid('analysis.confidence is not allowed');
  }
  if (typeof value.evidence !== 'string') return invalid('analysis.evidence must be a string');

  if (!Array.isArray(value.upcomingEvents)) return invalid('analysis.upcomingEvents must be an array');
  const upcomingEvents: AnalysisResult['upcomingEvents'] = [];
  for (const [i, ev] of value.upcomingEvents.entries()) {
    const path = `analysis.upcomingEvents[${i}]`;
    if (!isRecord(ev)) return invalid(`${path} is not an object`);
    const problem = keyProblem(ev, ['type', 'title', 'startsAt'], path);
    if (problem) return invalid(problem);
    if (!isOneOf(EVENT_TYPES, ev.type)) return invalid(`${path}.type is not allowed`);
    if (typeof ev.title !== 'string') return invalid(`${path}.title must be a string`);
    if (!isStringOrNull(ev.startsAt)) return invalid(`${path}.startsAt must be a string or null`);
    upcomingEvents.push({ type: ev.type, title: ev.title, startsAt: ev.startsAt });
  }

  if (!Array.isArray(value.opportunities)) return invalid('analysis.opportunities must be an array');
  const opportunities: AnalysisResult['opportunities'] = [];
  for (const [i, op] of value.opportunities.entries()) {
    const path = `analysis.opportunities[${i}]`;
    if (!isRecord(op)) return invalid(`${path} is not an object`);
    const problem = keyProblem(op, ['title', 'location'], path);
    if (problem) return invalid(problem);
    if (typeof op.title !== 'string') return invalid(`${path}.title must be a string`);
    if (!isStringOrNull(op.location)) return invalid(`${path}.location must be a string or null`);
    opportunities.push({ title: op.title, location: op.location });
  }

  return {
    ok: true,
    data: {
      emailKind: value.emailKind,
      company: value.company,
      role: value.role,
      status: value.status,
      confidence: value.confidence,
      evidence: value.evidence,
      upcomingEvents,
      opportunities,
    },
  };
}

// ---------------------------------------------------------------------------
// Sanitizer

const trimToNull = (s: string | null): string | null => {
  const t = s?.trim() ?? '';
  return t === '' ? null : t;
};

/**
 * Normalizes a validated result before it reaches the UI or the merge engine:
 * trims text, turns blank company/role/location into null, caps the evidence
 * quote, and forces `status: null` for email kinds that must not change status (R4.6).
 */
export function sanitizeAnalysis(a: AnalysisResult): AnalysisResult {
  const statusless = (NON_STATUS_EMAIL_KINDS as readonly string[]).includes(a.emailKind);
  return {
    ...a,
    company: trimToNull(a.company),
    role: trimToNull(a.role),
    status: statusless ? null : a.status,
    evidence: a.evidence.trim().slice(0, EVIDENCE_MAX_CHARS),
    upcomingEvents: a.upcomingEvents.map((e) => ({
      ...e,
      title: e.title.trim(),
      startsAt: trimToNull(e.startsAt),
    })),
    opportunities: a.opportunities.map((o) => ({
      title: o.title.trim(),
      location: trimToNull(o.location),
    })),
  };
}

/** Parses the model's JSON text, validates it, and sanitizes it. */
export function parseAnalysisJson(text: string): Result<AnalysisResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return invalid('response is not valid JSON');
  }
  const checked = validateAnalysis(raw);
  return checked.ok ? { ok: true, data: sanitizeAnalysis(checked.data) } : checked;
}
