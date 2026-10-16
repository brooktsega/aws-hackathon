import { describe, expect, it, vi } from 'vitest';
import { createViewHandler, extractActiveEmail, removeViewState, viewStateKey } from '../../src/background/extract';
import type { ExtractDeps } from '../../src/background/extract';
import type { EmailPayload } from '../../src/shared/types';
import { createMemoryArea } from '../chrome-stub';

const payload: EmailPayload = {
  subject: 'Hi',
  from: { name: 'A', address: 'a@acme.example' },
  to: 'me@example.org',
  date: 1,
  threadId: 't',
  messageKey: 'k',
  bodyText: 'body',
  truncated: false,
};
const gmailTab = { id: 3, url: 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQbcdefghijklmnop' };

const deps = (over: Partial<ExtractDeps> = {}): ExtractDeps => ({
  queryActiveTab: async () => gmailTab,
  sendToTab: async () => ({ ok: true, data: payload }),
  timeoutMs: 50,
  ...over,
});

describe('extractActiveEmail', () => {
  it('returns the payload from the active Gmail tab', async () => {
    const sendToTab = vi.fn(async () => ({ ok: true, data: payload }));
    const r = await extractActiveEmail(deps({ sendToTab }));
    expect(r).toEqual({ ok: true, data: payload });
    expect(sendToTab).toHaveBeenCalledWith(3, { type: 'EXTRACT_EMAIL' });
  });

  it.each([
    ['no tab', undefined],
    ['a non-Gmail tab (URL hidden)', { id: 1 }],
    ['another site', { id: 1, url: 'https://example.com/' }],
    ['a lookalike host', { id: 1, url: 'https://mail.google.com.evil.example/' }],
  ])('returns NO_EMAIL_OPEN for %s', async (_name, tab) => {
    const sendToTab = vi.fn();
    const r = await extractActiveEmail(deps({ queryActiveTab: async () => tab, sendToTab }));
    expect(r).toMatchObject({ ok: false, error: { code: 'NO_EMAIL_OPEN' } });
    expect(sendToTab).not.toHaveBeenCalled();
  });

  it('maps content-script errors', async () => {
    const noEmail = await extractActiveEmail(
      deps({ sendToTab: async () => ({ ok: false, error: { code: 'NO_EMAIL_OPEN', message: 'x' } }) }),
    );
    expect(noEmail).toMatchObject({ ok: false, error: { code: 'NO_EMAIL_OPEN' } });
    const dom = await extractActiveEmail(
      deps({ sendToTab: async () => ({ ok: false, error: { code: 'GMAIL_DOM_UNRECOGNIZED', message: 'x' } }) }),
    );
    expect(dom).toMatchObject({ ok: false, error: { code: 'GMAIL_DOM_UNRECOGNIZED' } });
  });

  it('returns CONTENT_SCRIPT_UNREACHABLE when the script is missing or silent (R12.3)', async () => {
    const missing = await extractActiveEmail(
      deps({ sendToTab: async () => Promise.reject(new Error('Could not establish connection. Receiving end does not exist.')) }),
    );
    expect(missing).toMatchObject({ ok: false, error: { code: 'CONTENT_SCRIPT_UNREACHABLE' } });

    const silent = await extractActiveEmail(deps({ sendToTab: () => new Promise(() => undefined), timeoutMs: 20 }));
    expect(silent).toMatchObject({ ok: false, error: { code: 'CONTENT_SCRIPT_UNREACHABLE' } });

    const undef = await extractActiveEmail(deps({ sendToTab: async () => undefined }));
    expect(undef).toMatchObject({ ok: false, error: { code: 'CONTENT_SCRIPT_UNREACHABLE' } });
  });

  it('rejects a malformed payload from the page rather than trusting it', async () => {
    const r = await extractActiveEmail(deps({ sendToTab: async () => ({ ok: true, data: { subject: 'x' } }) }));
    expect(r).toMatchObject({ ok: false, error: { code: 'GMAIL_DOM_UNRECOGNIZED' } });
  });

  it('returns NO_EMAIL_OPEN when the tab query itself fails', async () => {
    const r = await extractActiveEmail(deps({ queryActiveTab: async () => Promise.reject(new Error('x')) }));
    expect(r).toMatchObject({ ok: false, error: { code: 'NO_EMAIL_OPEN' } });
  });
});

describe('view state (R2.9)', () => {
  const sender = { id: 'e', tab: { id: 9 } as chrome.tabs.Tab, url: 'https://mail.google.com/mail/u/0/' };

  it('stores the state under the sending tab and clears it when the tab closes', async () => {
    const area = createMemoryArea();
    const handle = createViewHandler(area);
    const r = await handle({ isThreadView: true, threadId: 'T' }, sender);
    expect(r).toEqual({ ok: true, data: undefined });
    expect(area.data[viewStateKey(9)]).toEqual({ isThreadView: true, threadId: 'T' });
    await removeViewState(area, 9);
    expect(area.data[viewStateKey(9)]).toBeUndefined();
  });

  it('rejects updates without a tab or with a bad payload', async () => {
    const area = createMemoryArea();
    const handle = createViewHandler(area);
    expect(await handle({ isThreadView: true }, { id: 'e' })).toMatchObject({ ok: false });
    expect(await handle({ isThreadView: 'yes' } as never, sender)).toMatchObject({ ok: false });
    expect(Object.keys(area.data)).toHaveLength(0);
  });

  it('does not store unexpected extra fields', async () => {
    const area = createMemoryArea();
    await createViewHandler(area)({ isThreadView: false, evil: '<script>' } as never, sender);
    expect(area.data[viewStateKey(9)]).toEqual({ isThreadView: false });
  });
});
