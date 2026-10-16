import { describe, expect, it } from 'vitest';
import { createStore, defaultState } from '../../src/background/storage';
import { DEFAULT_MODEL, SCHEMA_VERSION, STORAGE_KEYS } from '../../src/shared/constants';
import { createMemoryArea } from '../chrome-stub';
import { T0, entry, makeApp } from '../helpers';

const app = makeApp('a1', 'Acme', 'SWE', [entry('applied', T0)]);

describe('store.load', () => {
  it('returns defaults for an empty store', async () => {
    const state = await createStore(createMemoryArea()).load();
    expect(state).toEqual({ ...defaultState(), schemaVersion: 0 });
    expect(state.settings.model).toBe(DEFAULT_MODEL);
  });

  it('falls back to defaults for malformed values', async () => {
    const area = createMemoryArea({ [STORAGE_KEYS.applications]: 'oops', [STORAGE_KEYS.alerts]: [1, 2] });
    const state = await createStore(area).load();
    expect(state.applications).toEqual({});
    expect(state.alerts).toEqual({});
  });

  it('fills missing settings fields from defaults', async () => {
    const area = createMemoryArea({ [STORAGE_KEYS.settings]: { apiKey: 'k' } });
    const state = await createStore(area).load();
    expect(state.settings).toEqual({ apiKey: 'k', model: DEFAULT_MODEL, disclosureAccepted: false });
  });
});

describe('store.transaction (R6.1, R6.4)', () => {
  it('applies a pure update and returns its result', async () => {
    const area = createMemoryArea();
    const store = createStore(area);
    const r = await store.transaction((s) => ({
      ok: true,
      state: { ...s, applications: { ...s.applications, a1: app } },
      result: 'saved',
    }));
    expect(r).toEqual({ ok: true, data: 'saved' });
    expect(area.data[STORAGE_KEYS.applications]).toEqual({ a1: app });
  });

  it('writes only the keys that changed, in a single set call', async () => {
    const area = createMemoryArea();
    const store = createStore(area);
    await store.transaction((s) => ({
      ok: true,
      state: { ...s, applications: { a1: app }, processed: { k: 'a1' } },
      result: null,
    }));
    expect(area.setCalls).toHaveLength(1);
    expect(Object.keys(area.setCalls[0]!).sort()).toEqual([STORAGE_KEYS.applications, STORAGE_KEYS.processed].sort());
  });

  it('does not write when nothing changed', async () => {
    const area = createMemoryArea();
    await createStore(area).transaction((s) => ({ ok: true, state: s, result: null }));
    expect(area.setCalls).toHaveLength(0);
  });

  it('returns STORAGE_WRITE_FAILED and leaves stored data unchanged when the write fails', async () => {
    const area = createMemoryArea({ [STORAGE_KEYS.applications]: { a1: app } });
    const store = createStore(area);
    area.failNextSet();
    const r = await store.transaction((s) => ({ ok: true, state: { ...s, applications: {} }, result: null }));
    expect(r).toMatchObject({ ok: false, error: { code: 'STORAGE_WRITE_FAILED' } });
    expect(area.data[STORAGE_KEYS.applications]).toEqual({ a1: app });
    // The store recovers afterwards.
    const again = await store.transaction((s) => ({ ok: true, state: { ...s, applications: {} }, result: null }));
    expect(again.ok).toBe(true);
  });

  it('passes through an aborting outcome without writing', async () => {
    const area = createMemoryArea();
    const r = await createStore(area).transaction(() => ({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'nope' },
    }));
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(area.setCalls).toHaveLength(0);
  });

  it('turns a throwing update function into INTERNAL without writing', async () => {
    const area = createMemoryArea();
    const r = await createStore(area).transaction(() => {
      throw new Error('boom');
    });
    expect(r).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(area.setCalls).toHaveLength(0);
  });

  it('serializes concurrent transactions so no update is lost', async () => {
    const area = createMemoryArea();
    const store = createStore(area);
    const bump = () =>
      store.transaction((s) => ({
        ok: true,
        state: { ...s, processed: { ...s.processed, [`k${Object.keys(s.processed).length}`]: 'x' } },
        result: null,
      }));
    await Promise.all([bump(), bump(), bump(), bump(), bump()]);
    expect(Object.keys(area.data[STORAGE_KEYS.processed] as object)).toHaveLength(5);
  });
});

describe('store.migrate (R6.3)', () => {
  it('initializes a fresh install once', async () => {
    const area = createMemoryArea();
    const store = createStore(area);
    expect(await store.migrate()).toEqual({ ok: true, data: undefined });
    expect(area.data[STORAGE_KEYS.schemaVersion]).toBe(SCHEMA_VERSION);
    expect(area.data[STORAGE_KEYS.settings]).toEqual(defaultState().settings);
    const writes = area.setCalls.length;
    await store.migrate();
    expect(area.setCalls).toHaveLength(writes); // already current: no write
  });

  it('runs registered migrations in order, exactly once', async () => {
    const area = createMemoryArea({ [STORAGE_KEYS.schemaVersion]: 1, [STORAGE_KEYS.processed]: {} });
    const store = createStore(area);
    const log: number[] = [];
    const migrations = {
      2: (s: ReturnType<typeof defaultState>) => (log.push(2), { ...s, processed: { ...s.processed, v2: 'x' } }),
      3: (s: ReturnType<typeof defaultState>) => (log.push(3), { ...s, processed: { ...s.processed, v3: 'x' } }),
    };
    await store.migrate(migrations, 3);
    expect(log).toEqual([2, 3]);
    expect(area.data[STORAGE_KEYS.schemaVersion]).toBe(3);
    expect(area.data[STORAGE_KEYS.processed]).toEqual({ v2: 'x', v3: 'x' });
    await store.migrate(migrations, 3);
    expect(log).toEqual([2, 3]);
  });

  it('reports a failed migration write', async () => {
    const area = createMemoryArea();
    area.failNextSet();
    expect(await createStore(area).migrate()).toMatchObject({ ok: false, error: { code: 'STORAGE_WRITE_FAILED' } });
  });
});

describe('store.restrictAccess (R10.6)', () => {
  it('limits storage to trusted contexts', async () => {
    const area = createMemoryArea();
    await createStore(area).restrictAccess();
    expect(area.accessLevel).toBe('TRUSTED_CONTEXTS');
  });
});
