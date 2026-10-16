import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  createDeleteAllDataHandler,
  createGetSettingsHandler,
  createSaveSettingsHandler,
  createTestConnectionHandler,
  toSettingsView,
} from '../../src/background/settings';
import { createStore } from '../../src/background/storage';
import { DEFAULT_MODEL, STORAGE_KEYS } from '../../src/shared/constants';
import { createMemoryArea } from '../chrome-stub';
import { T0, entry, makeApp } from '../helpers';

const sender = { id: 'e' };
const KEY = 'sk-ant-api03-abcdefghijklmnop-WXYZ';

function setup(initial: Record<string, unknown> = {}, create = vi.fn(async () => ({ stop_reason: 'end_turn', content: [] as never[] }))) {
  const area = createMemoryArea(initial);
  const deps = { store: createStore(area), createClient: vi.fn(() => ({ messages: { create } })) };
  return {
    area,
    create,
    deps,
    get: createGetSettingsHandler(deps),
    save: createSaveSettingsHandler(deps),
    test: createTestConnectionHandler(deps),
    wipe: createDeleteAllDataHandler(deps),
  };
}

describe('toSettingsView (R10.2)', () => {
  it('exposes only whether a key exists and its last four characters', () => {
    const view = toSettingsView({ apiKey: KEY, model: 'm', disclosureAccepted: true });
    expect(view).toEqual({ hasKey: true, keyLast4: 'WXYZ', model: 'm', disclosureAccepted: true });
    expect(JSON.stringify(view)).not.toContain('abcdefghijklmnop');
    expect(toSettingsView({ model: 'm', disclosureAccepted: false })).toEqual({ hasKey: false, model: 'm', disclosureAccepted: false });
  });
});

describe('GET_SETTINGS / SAVE_SETTINGS (R10.1, R10.3)', () => {
  it('returns defaults on a fresh install', async () => {
    expect(await setup().get(undefined, sender)).toEqual({
      ok: true,
      data: { hasKey: false, model: DEFAULT_MODEL, disclosureAccepted: false },
    });
  });

  it('saves a key and never returns it', async () => {
    const t = setup();
    const r = await t.save({ apiKey: `  ${KEY}  ` }, sender);
    expect(r).toEqual({ ok: true, data: { hasKey: true, keyLast4: 'WXYZ', model: DEFAULT_MODEL, disclosureAccepted: false } });
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect((t.area.data[STORAGE_KEYS.settings] as { apiKey: string }).apiKey).toBe(KEY); // trimmed
    expect(JSON.stringify(await t.get(undefined, sender))).not.toContain(KEY);
  });

  it('clears the key with an empty string and leaves other fields alone', async () => {
    const t = setup();
    await t.save({ apiKey: KEY, model: 'claude-haiku-5-5', disclosureAccepted: true }, sender);
    const r = await t.save({ apiKey: '' }, sender);
    expect(r).toEqual({ ok: true, data: { hasKey: false, model: 'claude-haiku-5-5', disclosureAccepted: true } });
    expect(t.area.data[STORAGE_KEYS.settings]).not.toHaveProperty('apiKey');
  });

  it('changes the model and the disclosure flag independently', async () => {
    const t = setup();
    await t.save({ apiKey: KEY }, sender);
    await t.save({ model: ' claude-opus-5-5 ' }, sender);
    const r = await t.save({ disclosureAccepted: true }, sender);
    expect(r).toMatchObject({ ok: true, data: { hasKey: true, model: 'claude-opus-5-5', disclosureAccepted: true } });
  });

  it.each([
    [{ apiKey: 'short' }],
    [{ apiKey: 'has spaces in the middle of a long enough key' }],
    [{ apiKey: 123 }],
    [{ model: '' }],
    [{ model: 'bad model!' }],
    [{ model: 7 }],
    [{ disclosureAccepted: 'yes' }],
    [null],
  ])('rejects invalid settings %j without writing', async (payload) => {
    const t = setup();
    expect(await t.save(payload as never, sender)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(t.area.setCalls).toHaveLength(0);
  });
});

describe('TEST_CONNECTION (R10.4)', () => {
  const stored = { [STORAGE_KEYS.settings]: { apiKey: KEY, model: 'claude-sonnet-5-5', disclosureAccepted: true } };

  it('makes a minimal request with the stored key and model', async () => {
    const t = setup(stored);
    expect(await t.test(undefined, sender)).toEqual({ ok: true, data: undefined });
    expect(t.deps.createClient).toHaveBeenCalledWith(KEY);
    const params = (t.create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params.max_tokens).toBeLessThanOrEqual(256);
    expect(params).not.toHaveProperty('tools');
  });

  it('returns NO_API_KEY without a request', async () => {
    const t = setup();
    expect(await t.test(undefined, sender)).toMatchObject({ ok: false, error: { code: 'NO_API_KEY' } });
    expect(t.create).not.toHaveBeenCalled();
  });

  it('reports the specific failure', async () => {
    const reject = (status: number) => vi.fn(async () => {
      throw Anthropic.APIError.generate(status, { error: { message: 'x' } }, 'x', new Headers());
    });
    expect(await setup(stored, reject(401) as never).test(undefined, sender)).toMatchObject({ error: { code: 'AUTH_FAILED' } });
    expect(await setup(stored, reject(429) as never).test(undefined, sender)).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(await setup(stored, reject(404) as never).test(undefined, sender)).toMatchObject({ error: { code: 'REQUEST_REJECTED' } });
    expect(await setup(stored, reject(503) as never).test(undefined, sender)).toMatchObject({ error: { code: 'API_UNAVAILABLE' } });
  });
});

describe('DELETE_ALL_DATA (R10.5)', () => {
  it('clears applications, alerts, and processed keys but keeps settings', async () => {
    const app = makeApp('a1', 'Acme', 'SWE', [entry('applied', T0)]);
    const t = setup({
      [STORAGE_KEYS.applications]: { a1: app },
      [STORAGE_KEYS.alerts]: { x: { id: 'x' } },
      [STORAGE_KEYS.processed]: { k: 'a1' },
      [STORAGE_KEYS.settings]: { apiKey: KEY, model: 'm', disclosureAccepted: true },
    });
    expect(await t.wipe(undefined, sender)).toEqual({ ok: true, data: undefined });
    expect(t.area.data[STORAGE_KEYS.applications]).toEqual({});
    expect(t.area.data[STORAGE_KEYS.alerts]).toEqual({});
    expect(t.area.data[STORAGE_KEYS.processed]).toEqual({});
    expect(t.area.data[STORAGE_KEYS.settings]).toEqual({ apiKey: KEY, model: 'm', disclosureAccepted: true });
  });
});
