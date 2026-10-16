import { describe, expect, it, vi } from 'vitest';
import { createRouter } from '../../src/background/router';
import { LOCK_KEY, acquireLock, releaseLock, withLock } from '../../src/background/lock';
import { INFLIGHT_STALE_MS } from '../../src/shared/constants';
import { createMemoryArea } from '../chrome-stub';

const OWN = 'ext-id';
const panel = { id: OWN, url: `chrome-extension://${OWN}/sidepanel/index.html` };
const gmail = { id: OWN, url: 'https://mail.google.com/mail/u/0/#inbox', tab: { id: 7 } as chrome.tabs.Tab };

describe('createRouter', () => {
  it('dispatches to the handler for the message type and passes the payload', async () => {
    const dismiss = vi.fn(async () => ({ ok: true as const, data: undefined }));
    const route = createRouter({ DISMISS_ALERT: dismiss }, OWN);
    const r = await route({ type: 'DISMISS_ALERT', payload: { alertId: 'a' } }, panel);
    expect(r).toEqual({ ok: true, data: undefined });
    expect(dismiss).toHaveBeenCalledWith({ alertId: 'a' }, panel);
  });

  it.each([null, undefined, 'text', 42, {}, { type: 5 }, { type: 'NOT_A_TYPE' }])(
    'rejects malformed or unknown message %j',
    async (message) => {
      const r = await createRouter({}, OWN)(message, panel);
      expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    },
  );

  it('rejects a known type that has no handler here', async () => {
    const r = await createRouter({}, OWN)({ type: 'DELETE_ALL_DATA' }, panel);
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });

  it('converts a throwing handler into INTERNAL without leaking the error text', async () => {
    const route = createRouter({
      DELETE_ALL_DATA: async () => {
        throw new Error('secret sk-ant-123 leaked');
      },
    }, OWN);
    const r = await route({ type: 'DELETE_ALL_DATA' }, panel);
    expect(r).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(JSON.stringify(r)).not.toContain('sk-ant');
  });

  it('lets Gmail pages send only VIEW_CHANGED (least privilege)', async () => {
    const handlers = {
      VIEW_CHANGED: async () => ({ ok: true as const, data: undefined }),
      SAVE_SETTINGS: vi.fn(),
      DELETE_ALL_DATA: vi.fn(),
    };
    const route = createRouter(handlers, OWN);
    expect(await route({ type: 'VIEW_CHANGED', payload: { isThreadView: true } }, gmail)).toMatchObject({ ok: true });
    expect(await route({ type: 'SAVE_SETTINGS', payload: { apiKey: 'x' } }, gmail)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(await route({ type: 'DELETE_ALL_DATA' }, gmail)).toMatchObject({ ok: false });
    expect(handlers.SAVE_SETTINGS).not.toHaveBeenCalled();
    expect(handlers.DELETE_ALL_DATA).not.toHaveBeenCalled();
  });

  it('rejects messages from another extension id', async () => {
    const route = createRouter({ DELETE_ALL_DATA: async () => ({ ok: true as const, data: undefined }) }, OWN);
    const r = await route({ type: 'DELETE_ALL_DATA' }, { id: 'someone-else', url: 'chrome-extension://x/' });
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });
});

describe('analysis lock (R12.5)', () => {
  it('lets one caller in and rejects the second until released', async () => {
    const area = createMemoryArea();
    expect(await acquireLock(area, 1000)).toBe(true);
    expect(await acquireLock(area, 1001)).toBe(false);
    await releaseLock(area);
    expect(await acquireLock(area, 1002)).toBe(true);
  });

  it('ignores a stale lock', async () => {
    const area = createMemoryArea({ [LOCK_KEY]: 1000 });
    expect(await acquireLock(area, 1000 + INFLIGHT_STALE_MS - 1)).toBe(false);
    expect(await acquireLock(area, 1000 + INFLIGHT_STALE_MS)).toBe(true);
  });

  it('is atomic for simultaneous acquisitions', async () => {
    const area = createMemoryArea();
    const results = await Promise.all([acquireLock(area, 5), acquireLock(area, 5), acquireLock(area, 5)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('withLock returns ANALYSIS_IN_PROGRESS to a concurrent caller and always releases', async () => {
    const area = createMemoryArea();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = withLock(area, 1, async () => {
      await gate;
      return { ok: true as const, data: 'done' };
    });
    await Promise.resolve();
    const second = await withLock(area, 2, async () => ({ ok: true as const, data: 'never' }));
    expect(second).toMatchObject({ ok: false, error: { code: 'ANALYSIS_IN_PROGRESS' } });
    release();
    expect(await first).toEqual({ ok: true, data: 'done' });
    expect(area.data[LOCK_KEY]).toBeUndefined();
  });

  it('releases the lock when the task throws', async () => {
    const area = createMemoryArea();
    await expect(
      withLock(area, 1, async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    expect(area.data[LOCK_KEY]).toBeUndefined();
  });
});
