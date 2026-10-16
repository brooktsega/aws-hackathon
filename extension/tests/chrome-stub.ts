import type { KeyValueArea } from '../src/background/storage';

export interface MemoryArea extends KeyValueArea {
  data: Record<string, unknown>;
  setCalls: Record<string, unknown>[];
  accessLevel?: string;
  /** Makes the next `set` reject (simulates a quota or I/O error). */
  failNextSet(): void;
}

export function createMemoryArea(initial: Record<string, unknown> = {}): MemoryArea {
  let failNext = false;
  const area: MemoryArea = {
    data: { ...initial },
    setCalls: [],
    failNextSet() {
      failNext = true;
    },
    async get(keys) {
      const all = area.data;
      if (keys === null) return structuredClone(all);
      const list = typeof keys === 'string' ? [keys] : keys;
      const out: Record<string, unknown> = {};
      for (const k of list) if (k in all) out[k] = structuredClone(all[k]);
      return out;
    },
    async set(items) {
      if (failNext) {
        failNext = false;
        throw new Error('QUOTA_BYTES quota exceeded');
      }
      area.setCalls.push(structuredClone(items));
      for (const [k, v] of Object.entries(items)) area.data[k] = structuredClone(v);
    },
    async remove(keys) {
      for (const k of typeof keys === 'string' ? [keys] : keys) delete area.data[k];
    },
    async setAccessLevel({ accessLevel }) {
      area.accessLevel = accessLevel;
    },
  };
  return area;
}
