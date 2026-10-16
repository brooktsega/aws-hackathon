// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startViewTracker } from '../../src/content/view-tracker';
import type { MessageRequest } from '../../src/shared/messages';

const THREAD = 'FMfcgzQbcdefghijklmnop';

describe('startViewTracker (R2.9)', () => {
  let sent: MessageRequest<'VIEW_CHANGED'>[];
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="main"></div>';
    window.location.hash = '#inbox';
    sent = [];
    stop = startViewTracker({ doc: document, win: window, send: (m) => sent.push(m), debounceMs: 50 });
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  const settle = async () => {
    await vi.advanceTimersByTimeAsync(60); // MutationObserver callbacks are microtasks; then the debounce
  };

  it('reports the initial state immediately', () => {
    expect(sent).toEqual([{ type: 'VIEW_CHANGED', payload: { isThreadView: false } }]);
  });

  it('reports a thread view once the URL and subject are both present', async () => {
    window.location.hash = `#inbox/${THREAD}`;
    await settle();
    expect(sent).toHaveLength(1); // URL alone is not enough: no subject rendered yet

    document.getElementById('main')!.innerHTML = '<h2 class="hP">Subject</h2>';
    await settle();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({ type: 'VIEW_CHANGED', payload: { isThreadView: true, threadId: THREAD } });
  });

  it('reports leaving the thread', async () => {
    document.getElementById('main')!.innerHTML = '<h2 class="hP">Subject</h2>';
    window.location.hash = `#inbox/${THREAD}`;
    await settle();
    window.location.hash = '#inbox';
    await settle();
    expect(sent.map((m) => m.payload.isThreadView)).toEqual([false, true, false]);
  });

  it('does not resend when nothing changed, and debounces bursts of DOM changes', async () => {
    for (let i = 0; i < 20; i++) document.getElementById('main')!.append(document.createElement('p'));
    await settle();
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('stops reporting after being stopped', async () => {
    stop();
    window.location.hash = `#inbox/${THREAD}`;
    document.getElementById('main')!.innerHTML = '<h2 class="hP">Subject</h2>';
    await settle();
    expect(sent).toHaveLength(1);
  });
});
