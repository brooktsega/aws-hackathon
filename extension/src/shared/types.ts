// Shared domain and message types (design §4.1, §7). Types only; the literal
// tuples they derive from live in constants.ts.
import type {
  ALERT_STATES,
  ALERT_TYPES,
  CONFIDENCE_LEVELS,
  EMAIL_KINDS,
  ERROR_CODES,
  EVENT_TYPES,
  NON_STATUS_EMAIL_KINDS,
  STATUSES,
} from './constants';

export type Status = (typeof STATUSES)[number];
export type EmailKind = (typeof EMAIL_KINDS)[number];
export type NonStatusEmailKind = (typeof NON_STATUS_EMAIL_KINDS)[number];
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type AlertType = (typeof ALERT_TYPES)[number];
export type AlertState = (typeof ALERT_STATES)[number];
export type ErrorCode = (typeof ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Result envelope: every cross-context reply is a Result, never a thrown error.

export interface AppError {
  code: ErrorCode;
  message: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

// ---------------------------------------------------------------------------
// Email extraction (content script -> service worker)

export interface EmailAddress {
  name: string;
  address: string;
}

/** Plain-text view of the open Gmail conversation (R2). Never persisted. */
export interface EmailPayload {
  subject: string;
  from: EmailAddress;
  to: string;
  /** Epoch ms of the latest included message. */
  date: number;
  /** Gmail conversation id from the URL hash. */
  threadId: string;
  /** sha256(threadId + latest message date + sender + subject); dedupe key (R5.9). */
  messageKey: string;
  bodyText: string;
  truncated: boolean;
}

/** The persisted/echoed subset of an EmailPayload: no body text. */
export type EmailMeta = Omit<EmailPayload, 'bodyText' | 'truncated'>;

/** Per-tab Gmail view state reported by the content script (R2.9). */
export interface ViewState {
  isThreadView: boolean;
  threadId?: string;
}

// ---------------------------------------------------------------------------
// Claude analysis (design §6.2)

export interface UpcomingEvent {
  type: EventType;
  title: string;
  /** ISO-8601 with offset, or null when the email gives no exact time. */
  startsAt: string | null;
}

export interface Opportunity {
  title: string;
  location: string | null;
}

export interface AnalysisResult {
  emailKind: EmailKind;
  company: string | null;
  role: string | null;
  status: Status | null;
  confidence: Confidence;
  /** Short verbatim quote supporting the status (≤ EVIDENCE_MAX_CHARS). */
  evidence: string;
  upcomingEvents: UpcomingEvent[];
  opportunities: Opportunity[];
}

/** What the side panel holds between Analyze and Save (R3.5–R3.8). */
export interface AnalysisPreview {
  email: EmailMeta;
  analysis: AnalysisResult;
  truncated: boolean;
}

/** User edits applied on the result card before saving (R3.6). */
export interface AnalysisEdits {
  company: string | null;
  role: string | null;
  status: Status | null;
}

// ---------------------------------------------------------------------------
// Stored records (design §7)

export interface StatusEntry {
  status: Status;
  /** Epoch ms: the email's date, or "now" for manual entries. */
  at: number;
  source: 'email' | 'manual';
  messageKey?: string;
  threadId?: string;
  subject?: string;
  /** ≤ EVIDENCE_MAX_CHARS. */
  evidence?: string;
}

export interface Application {
  id: string;
  company: string;
  companyKey: string;
  role: string;
  roleKey: string;
  senderDomains: string[];
  /** Sorted ascending by `at`. */
  history: StatusEntry[];

  // Derived and cached by recompute() on every write (R5.4–R5.8).
  status: Status;
  appliedAt: number;
  appliedAtEstimated: boolean;
  firstResponseAt?: number;
  rejectedAt?: number;
  lastUpdateAt: number;
  createdAt: number;
}

export interface AlertSource {
  threadId: string;
  subject: string;
  messageKey: string;
}

export interface Alert {
  /** Deterministic hash, used for dedupe (R9.9). */
  id: string;
  type: AlertType;
  company: string;
  companyKey: string;
  applicationId?: string;
  /** True when the company matches a tracked Application (R9.3). */
  firmKnown: boolean;
  title: string;
  /** Epoch ms; upcoming_event only. */
  startsAt?: number;
  location?: string;
  source: AlertSource;
  state: AlertState;
  notifiedAt?: number;
  createdAt: number;
}

/** Stored settings. `apiKey` never leaves the service worker (R10, R11.3). */
export interface Settings {
  apiKey?: string;
  model: string;
  disclosureAccepted: boolean;
}

/** What the UI is allowed to see of Settings: no key material beyond the last 4 characters. */
export interface SettingsView {
  hasKey: boolean;
  keyLast4?: string;
  model: string;
  disclosureAccepted: boolean;
}

/** Everything persisted in chrome.storage.local (design §7). */
export interface StoredState {
  schemaVersion: number;
  applications: Record<string, Application>;
  alerts: Record<string, Alert>;
  /** messageKey -> applicationId (or '' for emails that created only alerts). */
  processed: Record<string, string>;
  settings: Settings;
}
