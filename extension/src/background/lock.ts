// In-flight analysis lock (R12.5, design §4.4), kept in storage.session so it
// survives a worker restart; a lock older than INFLIGHT_STALE_MS is ignored.
import { INFLIGHT_STALE_MS } from '../shared/constants';
import type { Result } from '../shared/types';
import type { KeyValueArea } from './storage';

export const LOCK_KEY = 'analysis:inflight';

let chain: Promise<unknown> = Promise.resolve();

/** Serializes the check-then-set so two simultaneous clicks cannot both acquire. */
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task);
  chain = run.catch(() => undefined);
  return run;
}

export async function acquireLock(area: KeyValueArea, now: number): Promise<boolean> {
  return exclusive(async () => {
    const held = (await area.get(LOCK_KEY))[LOCK_KEY];
    if (typeof held === 'number' && now - held < INFLIGHT_STALE_MS) return false;
    await area.set({ [LOCK_KEY]: now });
    return true;
  });
}

export async function releaseLock(area: KeyValueArea): Promise<void> {
  await exclusive(() => area.remove(LOCK_KEY));
}

/** Runs `task` while holding the lock; a second concurrent call gets ANALYSIS_IN_PROGRESS. */
export async function withLock<T>(
  area: KeyValueArea,
  now: number,
  task: () => Promise<Result<T>>,
): Promise<Result<T>> {
  if (!(await acquireLock(area, now))) {
    return { ok: false, error: { code: 'ANALYSIS_IN_PROGRESS', message: 'An analysis is already running.' } };
  }
  try {
    return await task();
  } finally {
    await releaseLock(area);
  }
}
