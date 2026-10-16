// Pure Gmail DOM -> EmailPayload parser (R2, design §5). Reads a Document and a
// URL; never mutates the live DOM (it works on clones) and never touches the network.
import { MAX_BODY_CHARS } from '../shared/constants';
import { hashString } from '../shared/hash';
import type { AppError, EmailPayload, Result, ViewState } from '../shared/types';
import { SELECTORS, queryAll, queryFirst } from './gmail-selectors';

const fail = (code: AppError['code'], message: string): Result<never> => ({
  ok: false,
  error: { code, message },
});

// ---------------------------------------------------------------------------
// URL and view state

/**
 * Conversation id from a Gmail URL hash such as `#inbox/FMfcgzQ...` or
 * `#label/Jobs/FMfcgzQ...`. Returns null for list views (`#inbox`, `#search/foo`).
 */
export function threadIdFromUrl(url: string): string | null {
  const hashIndex = url.indexOf('#');
  if (hashIndex < 0) return null;
  const path = url.slice(hashIndex + 1).split('?')[0] ?? '';
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const last = decodeURIComponent(parts[parts.length - 1] as string);
  return /^[A-Za-z0-9_-]{16,}$/.test(last) ? last : null;
}

/** A conversation view needs both a conversation URL and a rendered subject (R2.9). */
export function getViewState(doc: Document, url: string): ViewState {
  const threadId = threadIdFromUrl(url);
  if (threadId !== null && queryFirst(doc, 'subject') !== null) {
    return { isThreadView: true, threadId };
  }
  return { isThreadView: false };
}

// ---------------------------------------------------------------------------
// Text extraction

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIELDSET', 'FOOTER', 'FORM',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'TABLE', 'TR', 'UL',
]);

function collectText(node: Node, out: string[]): void {
  if (node.nodeType === 3) {
    out.push(node.nodeValue ?? '');
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  if (el.tagName === 'BR') {
    out.push('\n');
    return;
  }
  const block = BLOCK_TAGS.has(el.tagName);
  if (block) out.push('\n');
  for (const child of Array.from(el.childNodes)) collectText(child, out);
  if (block) out.push('\n');
}

function tidy(raw: string): string {
  return raw
    .replace(/[\u00a0\u202f]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function textOf(node: Node): string {
  const out: string[] = [];
  collectText(node, out);
  return tidy(out.join(''));
}

/** Plain text of a message body without quoted history. Falls back to the full text if stripping empties it. */
export function bodyText(body: Element): string {
  const clone = body.cloneNode(true) as Element;
  for (const selector of SELECTORS.ignored) clone.querySelectorAll(selector).forEach((n) => n.remove());
  const full = textOf(clone);
  for (const selector of SELECTORS.quoted) clone.querySelectorAll(selector).forEach((n) => n.remove());
  const stripped = textOf(clone);
  return stripped !== '' ? stripped : full;
}

// ---------------------------------------------------------------------------
// Dates

/** Parses Gmail's full-timestamp tooltip. Returns null if the locale/format is not understood. */
export function parseGmailDate(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[\u00a0\u202f]/g, ' ').trim();
  const t = Date.parse(cleaned);
  return Number.isNaN(t) ? null : t;
}

// ---------------------------------------------------------------------------
// Messages

interface ParsedMessage {
  name: string;
  address: string;
  to: string;
  date: number | null;
  text: string;
}

function parseMessage(container: Element): ParsedMessage | null {
  const body = queryFirst(container, 'body');
  const sender = queryFirst(container, 'sender');
  if (!body || !sender) return null; // collapsed or unrecognized
  const address = sender.getAttribute('email')?.trim() ?? '';
  if (address === '') return null;
  const text = bodyText(body);
  if (text === '') return null;

  const recipients = queryAll(container, 'recipient')
    .map((r) => r.getAttribute('email')?.trim() ?? '')
    .filter(Boolean);

  return {
    name: sender.getAttribute('name')?.trim() || sender.textContent?.trim() || address,
    address,
    to: [...new Set(recipients)].join(', '),
    date: parseGmailDate(queryFirst(container, 'date')?.getAttribute('title')),
    text,
  };
}

const formatBlock = (m: ParsedMessage): string =>
  `From: ${m.name} <${m.address}> | Date: ${m.date === null ? 'unknown' : new Date(m.date).toISOString()}\n${m.text}`;

/**
 * Extracts the open conversation as an EmailPayload.
 * Errors: NO_EMAIL_OPEN (not a conversation URL), GMAIL_DOM_UNRECOGNIZED (expected elements missing).
 */
export function parseEmail(doc: Document, url: string): Result<EmailPayload> {
  const threadId = threadIdFromUrl(url);
  if (threadId === null) return fail('NO_EMAIL_OPEN', 'No email is open.');

  const subjectEl = queryFirst(doc, 'subject');
  const subject = subjectEl ? textOf(subjectEl) : '';
  if (subject === '') return fail('GMAIL_DOM_UNRECOGNIZED', 'Could not find the email subject.');

  const messages = queryAll(doc, 'message')
    .map(parseMessage)
    .filter((m): m is ParsedMessage => m !== null);
  if (messages.length === 0) {
    return fail('GMAIL_DOM_UNRECOGNIZED', 'Could not find an expanded message to read.');
  }

  const latest = messages[messages.length - 1] as ParsedMessage;
  const dates = messages.map((m) => m.date).filter((d): d is number => d !== null);
  if (dates.length === 0) {
    return fail('GMAIL_DOM_UNRECOGNIZED', 'Could not read the message date.');
  }
  const date = Math.max(...dates);

  let bodyTextOut = messages.map(formatBlock).join('\n\n---\n\n');
  let truncated = false;
  if (bodyTextOut.length > MAX_BODY_CHARS) {
    truncated = true;
    bodyTextOut = bodyTextOut.slice(-MAX_BODY_CHARS).trimStart(); // keep the newest content (R2.5)
  }

  return {
    ok: true,
    data: {
      subject,
      from: { name: latest.name, address: latest.address },
      to: latest.to,
      date,
      threadId,
      messageKey: hashString([threadId, date, latest.address, subject].join('|')),
      bodyText: bodyTextOut,
      truncated,
    },
  };
}
