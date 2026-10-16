import { describe, expect, it, vi } from 'vitest';
import { createAnalyzeHandler } from '../../src/background/analyze';
import type { AnalyzeDeps } from '../../src/background/analyze';
import { LOCK_KEY } from '../../src/background/lock';
import { createStore } from '../../src/background/storage';
import { STORAGE_KEYS } from '../../src/shared/constants';
import type { EmailPayload } from '../../src/shared/types';
import { createMemoryArea } from '../chrome-stub';
import { makeAnalysis } from '../helpers';

const email: EmailPayload = {
  subject: 'Thanks for applying',
  from: { name: 'Acme', address: 'jobs@acme.example' },
  to: 'me@example.org',
  date: 1_000,
  threadId: 'thread',
  messageKey: 'key',
  bodyText: 'SECRET BODY TEXT',
  truncated: true,
};
const sender = { id: 'e' };

function setup(settings: Record<string, unknown> | undefined, over: Partial<AnalyzeDeps> = {}) {
  const local = createMemoryArea(settings ? { [STORAGE_KEYS.settings]: settings } : {});
  const session = createMemoryArea();
  const create = vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(makeAnalysis()) }] }));
  const createClient = vi.fn(() => ({ messages: { create } }));
  const deps: AnalyzeDeps = {
    store: createStore(local),
    session,
    extract: async () => ({ ok: true, data: email }),
    createClient,
    now: () => 5_000,
    timeZone: () => 'UTC',
    ...over,
  };
  return { handler: createAnalyzeHandler(deps), local, session, create, createClient };
}

const ready = { apiKey: 'sk-ant-test-key-1234567890', model: 'claude-sonnet-5-5', disclosureAccepted: true };

describe('createAnalyzeHandler', () => {
  it('returns a preview without saving anything and without the email body', async () => {
    const { handler, local, create } = setup(ready);
    const r = await handler(undefined, sender);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.data.analysis).toEqual(makeAnalysis());
    expect(r.data.truncated).toBe(true);
    expect(r.data.email).toEqual({
      subject: 'Thanks for applying',
      from: { name: 'Acme', address: 'jobs@acme.example' },
      to: 'me@example.org',
      date: 1_000,
      threadId: 'thread',
      messageKey: 'key',
    });
    expect(JSON.stringify(r.data)).not.toContain('SECRET BODY TEXT');
    expect(local.setCalls).toHaveLength(0);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('passes the stored key and model to the client', async () => {
    const { handler, createClient, create } = setup({ ...ready, model: 'my-model' });
    await handler(undefined, sender);
    expect(createClient).toHaveBeenCalledWith(ready.apiKey);
    expect((create.mock.calls[0] as unknown as [{ model: string }])[0].model).toBe('my-model');
  });

  it('returns NO_API_KEY before touching the tab or the network', async () => {
    const extract = vi.fn();
    const { handler, create } = setup(undefined, { extract });
    expect(await handler(undefined, sender)).toMatchObject({ ok: false, error: { code: 'NO_API_KEY' } });
    expect(extract).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses to send anything until the disclosure was accepted (R11.2)', async () => {
    const extract = vi.fn();
    const { handler, create } = setup({ ...ready, disclosureAccepted: false }, { extract });
    expect(await handler(undefined, sender)).toMatchObject({ ok: false, error: { code: 'DISCLOSURE_REQUIRED' } });
    expect(extract).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('passes extraction errors through without calling Claude', async () => {
    const { handler, create } = setup(ready, {
      extract: async () => ({ ok: false, error: { code: 'NO_EMAIL_OPEN', message: 'x' } }),
    });
    expect(await handler(undefined, sender)).toMatchObject({ ok: false, error: { code: 'NO_EMAIL_OPEN' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('passes Claude errors through', async () => {
    const { handler, create } = setup(ready);
    create.mockResolvedValueOnce({ stop_reason: 'refusal', content: [] });
    expect(await handler(undefined, sender)).toMatchObject({ ok: false, error: { code: 'MODEL_REFUSED' } });
  });

  it('allows only one analysis at a time and releases the lock afterwards (R12.5)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { handler, session } = setup(ready, {
      extract: async () => {
        await gate;
        return { ok: true, data: email };
      },
    });
    const first = handler(undefined, sender);
    await new Promise((r) => setTimeout(r, 0));
    expect(await handler(undefined, sender)).toMatchObject({ ok: false, error: { code: 'ANALYSIS_IN_PROGRESS' } });
    release();
    expect((await first).ok).toBe(true);
    expect(session.data[LOCK_KEY]).toBeUndefined();
    expect((await handler(undefined, sender)).ok).toBe(true);
  });
});
