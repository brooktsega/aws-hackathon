// Typed wrapper over chrome.storage.local (R6, design §7). The service worker is
// the only writer: every change is a transaction (read -> pure function -> one
// set), serialized so concurrent handlers cannot interleave.
import { DEFAULT_MODEL, SCHEMA_VERSION, STORAGE_KEYS } from '../shared/constants';
import type { AppError, Result, StoredState } from '../shared/types';

/** The subset of chrome.storage.StorageArea this module needs (lets tests inject a memory area). */
export interface KeyValueArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  setAccessLevel?(options: { accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }): Promise<void>;
}

export function defaultState(): StoredState {
  return {
    schemaVersion: SCHEMA_VERSION,
    applications: {},
    alerts: {},
    processed: {},
    settings: { model: DEFAULT_MODEL, disclosureAccepted: false },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads every key, falling back to defaults for anything missing or malformed. */
export async function loadState(area: KeyValueArea): Promise<StoredState> {
  const raw = await area.get(Object.values(STORAGE_KEYS));
  const d = defaultState();
  return {
    schemaVersion: typeof raw[STORAGE_KEYS.schemaVersion] === 'number' ? (raw[STORAGE_KEYS.schemaVersion] as number) : 0,
    applications: isRecord(raw[STORAGE_KEYS.applications]) ? (raw[STORAGE_KEYS.applications] as StoredState['applications']) : d.applications,
    alerts: isRecord(raw[STORAGE_KEYS.alerts]) ? (raw[STORAGE_KEYS.alerts] as StoredState['alerts']) : d.alerts,
    processed: isRecord(raw[STORAGE_KEYS.processed]) ? (raw[STORAGE_KEYS.processed] as StoredState['processed']) : d.processed,
    settings: isRecord(raw[STORAGE_KEYS.settings])
      ? { ...d.settings, ...(raw[STORAGE_KEYS.settings] as Partial<StoredState['settings']>) }
      : d.settings,
  };
}

export type TxOutcome<T> =
  | { ok: true; state: StoredState; result: T }
  | { ok: false; error: AppError };

/** Migrations keyed by the version they upgrade TO. Version 1 is the baseline, so there are none yet. */
export type Migrations = Record<number, (state: StoredState) => StoredState>;
export const MIGRATIONS: Migrations = {};

const writeFailed = (): AppError => ({ code: 'STORAGE_WRITE_FAILED', message: 'Could not save. Your data is unchanged.' });

export interface Store {
  load(): Promise<StoredState>;
  /** Runs `fn` on the current state and writes only the top-level keys it changed. */
  transaction<T>(fn: (state: StoredState) => TxOutcome<T>): Promise<Result<T>>;
  /** Brings stored data to the current schema version; a fresh install gets defaults. */
  migrate(migrations?: Migrations, target?: number): Promise<Result<void>>;
  /** Hides storage from content scripts so they cannot read the API key (R10.6). */
  restrictAccess(): Promise<void>;
}

const DATA_KEYS = ['applications', 'alerts', 'processed', 'settings'] as const;

export function createStore(area: KeyValueArea = chrome.storage.local): Store {
  let tail: Promise<unknown> = Promise.resolve();

  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };

  async function write(before: StoredState, after: StoredState): Promise<Result<void>> {
    const changed: Record<string, unknown> = {};
    for (const key of DATA_KEYS) if (after[key] !== before[key]) changed[STORAGE_KEYS[key]] = after[key];
    if (after.schemaVersion !== before.schemaVersion) changed[STORAGE_KEYS.schemaVersion] = after.schemaVersion;
    if (Object.keys(changed).length === 0) return { ok: true, data: undefined };
    try {
      await area.set(changed);
      return { ok: true, data: undefined };
    } catch {
      return { ok: false, error: writeFailed() };
    }
  }

  return {
    load: () => loadState(area),

    transaction: <T>(fn: (state: StoredState) => TxOutcome<T>) =>
      serialize(async (): Promise<Result<T>> => {
        let before: StoredState;
        try {
          before = await loadState(area);
        } catch {
          return { ok: false, error: { code: 'INTERNAL', message: 'Could not read stored data.' } };
        }
        let outcome: TxOutcome<T>;
        try {
          outcome = fn(before);
        } catch {
          return { ok: false, error: { code: 'INTERNAL', message: 'Unexpected error while updating data.' } };
        }
        if (!outcome.ok) return outcome;
        const written = await write(before, outcome.state);
        return written.ok ? { ok: true, data: outcome.result } : written;
      }),

    migrate: (migrations = MIGRATIONS, target = SCHEMA_VERSION) =>
      serialize(async (): Promise<Result<void>> => {
        const before = await loadState(area);
        if (before.schemaVersion >= target) return { ok: true, data: undefined };
        let state: StoredState = before;
        for (let v = Math.max(before.schemaVersion, 0) + 1; v <= target; v++) {
          const step = migrations[v];
          if (step) state = step(state);
          state = { ...state, schemaVersion: v };
        }
        // Fresh installs have nothing stored, so persist every key once.
        const full: Record<string, unknown> = {
          [STORAGE_KEYS.schemaVersion]: state.schemaVersion,
          [STORAGE_KEYS.applications]: state.applications,
          [STORAGE_KEYS.alerts]: state.alerts,
          [STORAGE_KEYS.processed]: state.processed,
          [STORAGE_KEYS.settings]: state.settings,
        };
        try {
          await area.set(full);
          return { ok: true, data: undefined };
        } catch {
          return { ok: false, error: writeFailed() };
        }
      }),

    restrictAccess: async () => {
      await area.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
    },
  };
}
