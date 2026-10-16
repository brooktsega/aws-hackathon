import { describe, expect, it } from 'vitest';
import { MESSAGE_TYPES } from '../../src/shared/messages';
import type { MessageRequest, MessageResponse } from '../../src/shared/messages';

describe('message types', () => {
  it('accepts well-formed requests and responses (checked by tsc)', () => {
    const noPayload = { type: 'ANALYZE_ACTIVE_EMAIL' } satisfies MessageRequest;
    const withPayload = {
      type: 'DISMISS_ALERT',
      payload: { alertId: 'a1' },
    } satisfies MessageRequest;
    const failure: MessageResponse<'DELETE_ALL_DATA'> = {
      ok: false,
      error: { code: 'STORAGE_WRITE_FAILED', message: 'x' },
    };

    // @ts-expect-error DISMISS_ALERT requires a payload
    const missingPayload: MessageRequest = { type: 'DISMISS_ALERT' };
    // @ts-expect-error unknown error codes are rejected
    const badCode: MessageResponse<'DELETE_ALL_DATA'> = { ok: false, error: { code: 'NOPE', message: '' } };

    expect(MESSAGE_TYPES).toContain(noPayload.type);
    expect(MESSAGE_TYPES).toContain(withPayload.type);
    expect(failure.ok).toBe(false);
    expect([missingPayload, badCode]).toHaveLength(2);
  });
});
