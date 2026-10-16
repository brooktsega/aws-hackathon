// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getViewState,
  parseEmail,
  parseGmailDate,
  threadIdFromUrl,
} from '../../src/content/gmail-parser';
import { MAX_BODY_CHARS } from '../../src/shared/constants';

const THREAD = 'FMfcgzQbcdefghijklmnop';
const OPEN = `https://mail.google.com/mail/u/0/#inbox/${THREAD}`;

function load(name: string): Document {
  const html = readFileSync(resolve(__dirname, '../fixtures/gmail', name), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}

const ok = (doc: Document, url = OPEN) => {
  const r = parseEmail(doc, url);
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.data;
};

describe('threadIdFromUrl', () => {
  it.each([
    [`https://mail.google.com/mail/u/0/#inbox/${THREAD}`, THREAD],
    [`https://mail.google.com/mail/u/1/#label/Jobs/${THREAD}`, THREAD],
    [`https://mail.google.com/mail/u/0/#search/acme/${THREAD}`, THREAD],
    [`https://mail.google.com/mail/u/0/#all/${THREAD}?compose=new`, THREAD],
    ['https://mail.google.com/mail/u/0/#inbox', null],
    ['https://mail.google.com/mail/u/0/#search/acme', null],
    ['https://mail.google.com/mail/u/0/#label/Jobs', null],
    ['https://mail.google.com/mail/u/0/', null],
  ])('%s -> %s', (url, expected) => {
    expect(threadIdFromUrl(url)).toBe(expected);
  });
});

describe('parseGmailDate', () => {
  it('parses Gmail tooltips, including the narrow no-break space', () => {
    const expected = new Date(2026, 9, 1, 8, 0).getTime();
    expect(parseGmailDate('Thu, Oct 1, 2026, 8:00 AM')).toBe(expected);
    expect(parseGmailDate('Thu, Oct 1, 2026, 8:00 AM')).toBe(expected);
  });

  it('returns null for empty or unparseable text', () => {
    expect(parseGmailDate(null)).toBeNull();
    expect(parseGmailDate('')).toBeNull();
    expect(parseGmailDate('hier à 08:00')).toBeNull();
  });
});

describe('getViewState (R2.9)', () => {
  it('is a thread view for a conversation URL with a rendered subject', () => {
    expect(getViewState(load('single-message.html'), OPEN)).toEqual({ isThreadView: true, threadId: THREAD });
  });

  it('is not a thread view for list URLs or when the subject is missing', () => {
    expect(getViewState(load('inbox-list.html'), 'https://mail.google.com/mail/u/0/#inbox')).toEqual({
      isThreadView: false,
    });
    expect(getViewState(load('inbox-list.html'), OPEN)).toEqual({ isThreadView: false });
  });
});

describe('parseEmail: single message (R2.1–R2.2)', () => {
  it('extracts subject, sender, recipient, date, and plain text', () => {
    const email = ok(load('single-message.html'));
    expect(email.subject).toBe('Thank you for applying to Acme');
    expect(email.from).toEqual({ name: 'Acme Recruiting', address: 'jobs@acme.example' });
    expect(email.to).toBe('candidate@example.org');
    expect(email.date).toBe(new Date(2026, 9, 1, 8, 0).getTime());
    expect(email.threadId).toBe(THREAD);
    expect(email.truncated).toBe(false);
    expect(email.bodyText).toContain('Hi Candidate,');
    expect(email.bodyText).toContain('Thank you for applying for the Software Engineer role at Acme.');
    expect(email.bodyText).toContain('Best,\nThe Acme Talent Team');
    expect(email.bodyText).not.toMatch(/<\/?(div|b|br|span)\b/i); // no markup
    expect(email.bodyText).toContain('Hi Candidate,\n\nThank you'); // paragraph break kept
  });

  it('produces a stable messageKey that changes with the conversation', () => {
    const a = ok(load('single-message.html'));
    const b = ok(load('single-message.html'));
    const c = ok(load('single-message.html'), `https://mail.google.com/mail/u/0/#inbox/${THREAD}zz`);
    expect(a.messageKey).toBe(b.messageKey);
    expect(a.messageKey).not.toBe(c.messageKey);
    expect(a.messageKey).not.toBe('');
  });
});

describe('parseEmail: multi-message threads (R2.3–R2.4)', () => {
  const email = ok(load('multi-message.html'));

  it('skips collapsed messages and keeps expanded ones in chronological order', () => {
    const first = email.bodyText.indexOf('Riley Recruiter <recruiter@globex.example>');
    const second = email.bodyText.indexOf('Candidate <candidate@example.org>');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    expect(email.bodyText).not.toContain('Collapsed snippet text');
  });

  it('removes quoted history', () => {
    expect(email.bodyText).toContain('Could you do an interview next Tuesday at 2pm');
    expect(email.bodyText).toContain('Tuesday at 2pm works for me');
    expect(email.bodyText).not.toContain('Original application received');
    expect(email.bodyText).not.toContain('quoted again');
    expect(email.bodyText).not.toContain('wrote:');
  });

  it('reports the latest message as the sender and uses the newest date', () => {
    expect(email.from.address).toBe('candidate@example.org');
    expect(email.date).toBe(new Date(2026, 8, 30, 16, 15).getTime());
    expect(email.to).toBe('recruiter@globex.example');
  });

  it('joins all recipients of a message', () => {
    // The first expanded message has two recipients; check via a single-message variant.
    const doc = load('multi-message.html');
    doc.querySelectorAll('div.adn')[2]?.remove();
    expect(ok(doc).to).toBe('candidate@example.org, hiring@globex.example');
  });
});

describe('parseEmail: errors (R2.6–R2.7)', () => {
  it('returns NO_EMAIL_OPEN on list views', () => {
    const r = parseEmail(load('inbox-list.html'), 'https://mail.google.com/mail/u/0/#inbox');
    expect(r).toMatchObject({ ok: false, error: { code: 'NO_EMAIL_OPEN' } });
  });

  it('returns GMAIL_DOM_UNRECOGNIZED when the message markup is not found', () => {
    const r = parseEmail(load('broken-dom.html'), OPEN);
    expect(r).toMatchObject({ ok: false, error: { code: 'GMAIL_DOM_UNRECOGNIZED' } });
  });

  it('returns GMAIL_DOM_UNRECOGNIZED when a conversation URL has no subject', () => {
    const r = parseEmail(load('inbox-list.html'), OPEN);
    expect(r).toMatchObject({ ok: false, error: { code: 'GMAIL_DOM_UNRECOGNIZED' } });
  });

  it('returns GMAIL_DOM_UNRECOGNIZED when no date can be read, rather than guessing', () => {
    const doc = load('single-message.html');
    doc.querySelector('.g3')?.setAttribute('title', 'not a date');
    expect(parseEmail(doc, OPEN)).toMatchObject({ ok: false, error: { code: 'GMAIL_DOM_UNRECOGNIZED' } });
  });
});

describe('parseEmail: truncation (R2.5)', () => {
  it('keeps the newest MAX_BODY_CHARS and flags truncation', () => {
    const doc = load('single-message.html');
    const body = doc.querySelector('.a3s') as Element;
    body.innerHTML = `<div>${'old '.repeat(6000)}</div><div>NEWEST-MARKER</div>`;
    const email = ok(doc);
    expect(email.truncated).toBe(true);
    expect(email.bodyText.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    expect(email.bodyText).toContain('NEWEST-MARKER');
    expect(email.bodyText).not.toContain('Hi Candidate');
  });

  it('does not flag short emails', () => {
    expect(ok(load('single-message.html')).truncated).toBe(false);
  });
});

describe('parseEmail: read-only (R2.8)', () => {
  it('does not mutate the live DOM', () => {
    const doc = load('multi-message.html');
    const before = doc.documentElement.outerHTML;
    ok(doc);
    expect(doc.documentElement.outerHTML).toBe(before);
  });

  it('falls back to the full text when everything is quoted', () => {
    const doc = load('single-message.html');
    (doc.querySelector('.a3s') as Element).innerHTML = '<blockquote>Forwarded offer details</blockquote>';
    expect(ok(doc).bodyText).toContain('Forwarded offer details');
  });
});
