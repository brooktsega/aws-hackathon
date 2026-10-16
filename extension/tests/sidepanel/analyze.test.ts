// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAvailability, createAnalyzeSection } from '../../src/sidepanel/analyze';
import type { AnalyzeContext } from '../../src/sidepanel/analyze';
import { createResultCard } from '../../src/sidepanel/result-card';
import type { MessageRequest } from '../../src/shared/messages';
import type { AnalysisPreview } from '../../src/shared/types';
import { makeAnalysis, makeEmail } from '../helpers';

const flush = () => new Promise((r) => setTimeout(r, 0));
const thread = { isThreadView: true, threadId: 'T' };
const ready: AnalyzeContext = { hasKey: true, disclosureAccepted: true, view: thread };
const previewOf = (over = {}, truncated = false): AnalysisPreview => ({ email: makeEmail(), analysis: makeAnalysis(over), truncated });
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement | undefined;
const input = (label: string) => document.querySelector(`input[id$="-${label}"]`) as HTMLInputElement;
const select = () => document.querySelector('select') as HTMLSelectElement;
const type = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('computeAvailability (R3.1–R3.3)', () => {
  it('requires a key first, then a conversation view', () => {
    expect(computeAvailability(false, thread)).toEqual({ kind: 'disabled', reason: 'no_key' });
    expect(computeAvailability(false, undefined)).toEqual({ kind: 'disabled', reason: 'no_key' });
    expect(computeAvailability(true, undefined)).toEqual({ kind: 'disabled', reason: 'not_thread' });
    expect(computeAvailability(true, { isThreadView: false })).toEqual({ kind: 'disabled', reason: 'not_thread' });
    expect(computeAvailability(true, thread)).toEqual({ kind: 'ready' });
  });
});

function setup(context: AnalyzeContext = ready, handler?: (req: MessageRequest) => unknown) {
  const calls: MessageRequest[] = [];
  const send = vi.fn(async (req: MessageRequest) => {
    calls.push(req);
    if (handler) return handler(req);
    if (req.type === 'ANALYZE_ACTIVE_EMAIL') return { ok: true, data: previewOf() };
    if (req.type === 'SAVE_ANALYSIS') return { ok: true, data: { applicationId: 'a1' } };
    return { ok: true, data: undefined };
  });
  const askDisclosure = vi.fn(async () => true);
  const openSettings = vi.fn();
  const section = createAnalyzeSection({ send: send as never, askDisclosure, openSettings });
  section.setContext(context);
  document.body.replaceChildren(section.element);
  return { section, calls, send, askDisclosure, openSettings };
}

describe('analyze section: availability UI', () => {
  beforeEach(() => document.body.replaceChildren());

  it('enables the button only for a conversation with a key', () => {
    setup();
    expect(button('Analyze this email')!.disabled).toBe(false);
  });

  it('explains a missing key and links to Settings (R3.3)', () => {
    const t = setup({ ...ready, hasKey: false });
    expect(button('Analyze this email')!.disabled).toBe(true);
    expect(document.body.textContent).toContain('Add your Anthropic API key');
    button('Open Settings')!.click();
    expect(t.openSettings).toHaveBeenCalled();
  });

  it('explains when no email is open (R3.2)', () => {
    setup({ ...ready, view: { isThreadView: false } });
    expect(button('Analyze this email')!.disabled).toBe(true);
    expect(document.body.textContent).toContain('Open an email in Gmail');
  });

  it('updates when the context changes', () => {
    const t = setup({ ...ready, view: undefined });
    expect(button('Analyze this email')!.disabled).toBe(true);
    t.section.setContext(ready);
    expect(button('Analyze this email')!.disabled).toBe(false);
  });
});

describe('analyze section: flow', () => {
  beforeEach(() => document.body.replaceChildren());

  it('shows a loading state, then the result card (R3.4–R3.5)', async () => {
    let finish!: (v: unknown) => void;
    const gate = new Promise((r) => (finish = r));
    setup(ready, (req) => (req.type === 'ANALYZE_ACTIVE_EMAIL' ? gate : { ok: true, data: undefined }));
    button('Analyze this email')!.click();
    await flush();
    expect(button('Analyzing…')!.disabled).toBe(true);
    expect(document.body.textContent).toContain('asking Claude');
    finish({ ok: true, data: previewOf() });
    await flush();
    expect(input('company').value).toBe('Acme');
    expect(input('role').value).toBe('Software Engineer');
    expect(select().value).toBe('applied');
    expect(document.body.textContent).toContain('Confidence: high');
    expect(document.body.textContent).toContain('Thanks for applying');
  });

  it('prevents a second concurrent analysis (R12.5)', async () => {
    let finish!: (v: unknown) => void;
    const gate = new Promise((r) => (finish = r));
    const t = setup(ready, (req) => (req.type === 'ANALYZE_ACTIVE_EMAIL' ? gate : { ok: true, data: undefined }));
    button('Analyze this email')!.click();
    await flush();
    button('Analyzing…')!.click();
    await flush();
    expect(t.calls.filter((c) => c.type === 'ANALYZE_ACTIVE_EMAIL')).toHaveLength(1);
    finish({ ok: true, data: previewOf() });
  });

  it('asks for the disclosure once, saves consent, then analyzes (R11.2)', async () => {
    const t = setup({ ...ready, disclosureAccepted: false });
    button('Analyze this email')!.click();
    await flush();
    expect(t.askDisclosure).toHaveBeenCalledTimes(1);
    expect(t.calls.map((c) => c.type)).toEqual(['SAVE_SETTINGS', 'ANALYZE_ACTIVE_EMAIL']);
    expect(t.calls[0]).toEqual({ type: 'SAVE_SETTINGS', payload: { disclosureAccepted: true } });
  });

  it('does not analyze if the disclosure is declined', async () => {
    const t = setup({ ...ready, disclosureAccepted: false });
    t.askDisclosure.mockResolvedValueOnce(false);
    button('Analyze this email')!.click();
    await flush();
    expect(t.calls).toHaveLength(0);
  });

  it('shows errors with their suggested action', async () => {
    const t = setup(ready, () => ({ ok: false, error: { code: 'AUTH_FAILED', message: 'x' } }));
    button('Analyze this email')!.click();
    await flush();
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('API key was rejected');
    button('Open Settings')!.click();
    expect(t.openSettings).toHaveBeenCalled();
  });

  it('offers retry for retryable errors', async () => {
    let n = 0;
    const t = setup(ready, (req) => {
      if (req.type !== 'ANALYZE_ACTIVE_EMAIL') return { ok: true, data: undefined };
      return ++n === 1 ? { ok: false, error: { code: 'RATE_LIMITED', message: 'x' } } : { ok: true, data: previewOf() };
    });
    button('Analyze this email')!.click();
    await flush();
    button('Try again')!.click();
    await flush();
    expect(t.calls.filter((c) => c.type === 'ANALYZE_ACTIVE_EMAIL')).toHaveLength(2);
    expect(input('company').value).toBe('Acme');
  });

  it('discards the result without writing anything (R3.8)', async () => {
    const t = setup();
    button('Analyze this email')!.click();
    await flush();
    button('Discard')!.click();
    expect(t.calls.map((c) => c.type)).toEqual(['ANALYZE_ACTIVE_EMAIL']);
    expect(document.querySelector('input')).toBeNull();
  });

  it('keeps the user’s edits when the context changes while the card is open', async () => {
    const t = setup();
    button('Analyze this email')!.click();
    await flush();
    type(input('company'), 'Edited Co');
    t.section.setContext({ ...ready, view: { isThreadView: true, threadId: 'other' } });
    expect(input('company').value).toBe('Edited Co');
  });
});

describe('result card: edit and save (R3.6–R3.10)', () => {
  beforeEach(() => document.body.replaceChildren());

  const mount = (preview: AnalysisPreview, onSave = vi.fn(async () => ({ ok: true as const, data: undefined })), onDiscard = vi.fn()) => {
    document.body.replaceChildren(createResultCard(preview, { onSave, onDiscard }));
    return { onSave, onDiscard };
  };

  it('saves the edited values', async () => {
    const { onSave } = mount(previewOf());
    type(input('company'), '  Globex ');
    type(input('role'), 'Data Analyst');
    type(select(), 'screening');
    button('Save')!.click();
    await flush();
    expect(onSave).toHaveBeenCalledWith({ company: 'Globex', role: 'Data Analyst', status: 'screening' });
  });

  it('blocks saving a status without a company', () => {
    mount(previewOf());
    type(input('company'), '   ');
    expect(button('Save')!.disabled).toBe(true);
    expect(document.body.textContent).toContain('Enter a company');
    type(input('company'), 'Acme');
    expect(button('Save')!.disabled).toBe(false);
  });

  it('offers “Save alerts” when no status is chosen and there are alerts to save', async () => {
    const preview = previewOf({ emailKind: 'new_opportunity', status: null, opportunities: [{ title: 'Staff Engineer', location: 'Remote' }] });
    const { onSave } = mount(preview);
    expect(document.body.textContent).toContain('Staff Engineer (Remote)');
    button('Save alerts')!.click();
    await flush();
    expect(onSave).toHaveBeenCalledWith({ company: 'Acme', role: 'Software Engineer', status: null });
  });

  it('disables saving when there is nothing to track', () => {
    mount(previewOf({ emailKind: 'other_job_related', status: null }));
    expect(button('Save alerts')!.disabled).toBe(true);
  });

  it('offers only Discard for emails that are not job related (R3.10)', () => {
    mount(previewOf({ emailKind: 'not_job_related', status: null, company: null }));
    expect(button('Save')).toBeUndefined();
    expect(button('Save alerts')).toBeUndefined();
    expect(document.body.textContent).toContain("doesn't look job related");
    expect(button('Discard')).toBeDefined();
  });

  it('tells the user when only part of a long email was analyzed (R3.9)', () => {
    mount(previewOf({}, true));
    expect(document.body.textContent).toContain('only the most recent part was analyzed');
    document.body.replaceChildren();
    mount(previewOf({}, false));
    expect(document.body.textContent).not.toContain('only the most recent part');
  });

  it('shows a save failure and lets the user try again', async () => {
    const { onSave } = mount(previewOf(), vi.fn(async () => ({ ok: false as const, error: { code: 'STORAGE_WRITE_FAILED' as const, message: "Couldn't save." } })) as never);
    button('Save')!.click();
    await flush();
    expect(document.body.textContent).toContain("Couldn't save.");
    expect(button('Save')!.disabled).toBe(false);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('renders model-provided text as text, never markup (R11.5)', () => {
    mount(previewOf({ company: '<img src=x onerror=alert(1)>', evidence: '<script>alert(1)</script>', upcomingEvents: [{ type: 'interview', title: '<b>Call</b>', startsAt: null }] }));
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
    expect(document.body.textContent).toContain('<script>alert(1)</script>');
  });

  it('lists upcoming events with their times', () => {
    mount(previewOf({ upcomingEvents: [{ type: 'interview', title: 'Onsite', startsAt: '2026-11-03T14:00:00-05:00' }, { type: 'deadline', title: 'Form', startsAt: null }] }));
    expect(document.body.textContent).toContain('Onsite (interview)');
    expect(document.body.textContent).toContain('time not given');
  });
});
