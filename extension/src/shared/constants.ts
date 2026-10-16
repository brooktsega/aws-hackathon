// Shared constants. Literal tuples here are the single source of truth for the
// string unions in types.ts (see design §4, §6.2, §7).

export const STATUSES = [
  'applied',
  'screening',
  'interview_scheduled',
  'offer',
  'rejected',
  'withdrawn',
] as const;

export const EMAIL_KINDS = [
  'application_confirmation',
  'status_update',
  'interview_invite',
  'offer',
  'rejection',
  'new_opportunity',
  'other_job_related',
  'not_job_related',
] as const;

/** Email kinds that must never change an Application's status (R4.6). */
export const NON_STATUS_EMAIL_KINDS = [
  'new_opportunity',
  'other_job_related',
  'not_job_related',
] as const;

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

export const EVENT_TYPES = ['interview', 'assessment', 'deadline', 'offer_expiry', 'other'] as const;

export const ALERT_TYPES = ['upcoming_event', 'new_opportunity'] as const;

export const ALERT_STATES = ['active', 'dismissed', 'past'] as const;

export const ERROR_CODES = [
  'NO_API_KEY',
  'NO_EMAIL_OPEN',
  'GMAIL_DOM_UNRECOGNIZED',
  'CONTENT_SCRIPT_UNREACHABLE',
  'AUTH_FAILED',
  'RATE_LIMITED',
  'API_UNAVAILABLE',
  'MODEL_REFUSED',
  'INVALID_MODEL_OUTPUT',
  'STORAGE_WRITE_FAILED',
  'REQUEST_REJECTED',
  'DISCLOSURE_REQUIRED',
  'ANALYSIS_IN_PROGRESS',
  'INVALID_REQUEST',
  'INTERNAL',
] as const;

export const STATUS_LABELS = {
  applied: 'Applied',
  screening: 'Screening',
  interview_scheduled: 'Interview Scheduled',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
} as const satisfies Record<(typeof STATUSES)[number], string>;

/** Kanban columns in display order (R7.1–R7.2). `closed` holds rejected and withdrawn. */
export const KANBAN_COLUMNS = [
  { id: 'applied', label: 'Applied', statuses: ['applied'] },
  { id: 'screening', label: 'Screening', statuses: ['screening'] },
  { id: 'interview_scheduled', label: 'Interview Scheduled', statuses: ['interview_scheduled'] },
  { id: 'offer', label: 'Offer', statuses: ['offer'] },
  { id: 'closed', label: 'Closed', statuses: ['rejected', 'withdrawn'] },
] as const;

/** chrome.storage.local keys (design §7). */
export const STORAGE_KEYS = {
  schemaVersion: 'schemaVersion',
  applications: 'applications',
  alerts: 'alerts',
  processed: 'processed',
  settings: 'settings',
} as const;

export const SCHEMA_VERSION = 1;

/** Default Claude model; user-configurable in Settings (assumption A1). */
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

/** Max characters of email text sent to Claude (R2.5). */
export const MAX_BODY_CHARS = 12_000;

/** Max characters of the evidence quote stored per history entry (R6.2). */
export const EVIDENCE_MAX_CHARS = 200;

/** Service worker waits this long for the content script to reply (R12.3). */
export const EXTRACT_TIMEOUT_MS = 5_000;

/** An in-flight analysis lock older than this is ignored (design §4.4). */
export const INFLIGHT_STALE_MS = 60_000;

/** Claude request limits (design §6). */
/** Thinking counts toward max_tokens on current models, so leave headroom beyond the ~300-token JSON answer. */
export const CLAUDE_MAX_TOKENS = 4096;
export const CLAUDE_TIMEOUT_MS = 60_000;
export const CLAUDE_MAX_RETRIES = 2;

/** Role matching: minimum token-set Jaccard similarity (design §8.2). */
export const ROLE_MATCH_THRESHOLD = 0.7;

/** Reminder lead time for upcoming-event alerts and sweep cadence (R9.5, design §9). */
export const ALERT_LEAD_MS = 24 * 60 * 60 * 1000;
export const ALERT_SWEEP_MINUTES = 30;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Weeks shown in the applications-per-week chart (design §10). */
export const WEEKLY_CHART_WEEKS = 12;

/** Role used when an email names a company but no role (R5.10). */
export const UNKNOWN_ROLE = 'Unknown role';

/** Friendly names for email kinds (result card). */
export const EMAIL_KIND_LABELS = {
  application_confirmation: 'Application confirmation',
  status_update: 'Status update',
  interview_invite: 'Interview invitation',
  offer: 'Offer',
  rejection: 'Rejection',
  new_opportunity: 'New opportunity',
  other_job_related: 'Other job-related email',
  not_job_related: 'Not job related',
} as const satisfies Record<(typeof EMAIL_KINDS)[number], string>;
