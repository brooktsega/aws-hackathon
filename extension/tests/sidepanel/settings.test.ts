// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsView } from '../../src/sidepanel/settings';
import type { MessageRequest } from '../../src/shared/messages';
import type { SettingsView } from '../../src/shared/types';

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(initial: SettingsView = { hasKey: false, model: 'claude-sonnet-5-5', disclosureAccepted: false }, confirmResult = true) {
  let settings = initial;
  const calls: MessageRequest[] = [];
  const send = vi.fn(async (req: MessageRequest) => {
    calls.push(req);
    switch (req.type) {
      case 'GET_SETTINGS':
        return { ok: true, data: settings };
      case 'SAVE_SETTINGS': {
        const p = req.payload;
        settings = {
          ...settings,
          ...(p.model ? { model: p.model } : {}),
          ...(p.apiKey !== undefined ? (p.apiKey === '' ? { hasKey: false, keyLast4: undefined } : { hasKey: true, keyLast4: p.apiKey.slice(-4) }) : {}),
        };
        return { ok: true, data: settings };
      }
      case 'TEST_CONNECTION':
        return { ok: true, data: undefined };
      default:
        return { ok: true, data: undefined };
    }
  });
  const onBack = vi.fn();
  const onChanged = vi.fn();
  const confirm = vi.fn(async () => confirmResult);
  const el = createSettingsView({ send: send as never, onBack, onChanged, confirm });
  document.body.replaceChildren(el);
  return { el, send, calls, onBack, onChanged, confirm };
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement;

describe('settings view', () => {
  beforeEach(() => document.body.replaceChildren());

  it('shows the current model and a masked key placeholder', async () => {
    setup({ hasKey: true, keyLast4: 'WXYZ', model: 'my-model', disclosureAccepted: true });
    await flush();
    expect($<HTMLInputElement>('#settings-model').value).toBe('my-model');
    const key = $<HTMLInputElement>('#settings-key');
    expect(key.type).toBe('password');
    expect(key.value).toBe('');
    expect(key.placeholder).toContain('WXYZ');
    expect(document.body.textContent).not.toContain('sk-ant');
  });

  it('saves a new key and clears the field (R10.1)', async () => {
    const t = setup();
    await flush();
    $<HTMLInputElement>('#settings-key').value = '  sk-ant-api03-abcdefghijklmnopqrstuvwxyz  ';
    button('Save').click();
    await flush();
    expect(t.calls).toContainEqual({ type: 'SAVE_SETTINGS', payload: { apiKey: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz' } });
    expect(t.onChanged).toHaveBeenCalledTimes(1);
    expect($<HTMLInputElement>('#settings-key').value).toBe('');
    expect($<HTMLInputElement>('#settings-key').placeholder).toContain('wxyz');
    expect(document.body.textContent).toContain('Saved.');
  });

  it('saves only the model when only the model changed (R10.3)', async () => {
    const t = setup();
    await flush();
    $<HTMLInputElement>('#settings-model').value = 'claude-opus-5-5';
    button('Save').click();
    await flush();
    expect(t.calls.filter((c) => c.type === 'SAVE_SETTINGS')).toEqual([{ type: 'SAVE_SETTINGS', payload: { model: 'claude-opus-5-5' } }]);
  });

  it('says so when there is nothing to save', async () => {
    const t = setup();
    await flush();
    button('Save').click();
    await flush();
    expect(t.calls.filter((c) => c.type === 'SAVE_SETTINGS')).toHaveLength(0);
    expect(document.body.textContent).toContain('Nothing to save.');
  });

  it('removes the key', async () => {
    const t = setup({ hasKey: true, keyLast4: 'WXYZ', model: 'm', disclosureAccepted: true });
    await flush();
    button('Remove key').click();
    await flush();
    expect(t.calls).toContainEqual({ type: 'SAVE_SETTINGS', payload: { apiKey: '' } });
    expect(button('Remove key').disabled).toBe(true);
  });

  it('shows validation errors from the worker', async () => {
    const t = setup();
    await flush();
    t.send.mockResolvedValueOnce({ ok: false, error: { code: 'INVALID_REQUEST', message: "That doesn't look like an API key." } } as never);
    $<HTMLInputElement>('#settings-key').value = 'abc';
    button('Save').click();
    await flush();
    expect(document.body.textContent).toContain("That doesn't look like an API key.");
  });

  it('tests the connection and reports success or the specific failure (R10.4)', async () => {
    const t = setup({ hasKey: true, keyLast4: '1234', model: 'm', disclosureAccepted: true });
    await flush();
    button('Test connection').click();
    await flush();
    expect(document.body.textContent).toContain('Connection works.');
    t.send.mockResolvedValueOnce({ ok: false, error: { code: 'AUTH_FAILED', message: 'x' } } as never);
    button('Test connection').click();
    await flush();
    expect(document.body.textContent).toContain('Your API key was rejected');
  });

  it('saves pending edits before testing the connection', async () => {
    const t = setup();
    await flush();
    $<HTMLInputElement>('#settings-key').value = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
    button('Test connection').click();
    await flush();
    const types = t.calls.map((c) => c.type);
    expect(types.indexOf('SAVE_SETTINGS')).toBeLessThan(types.indexOf('TEST_CONNECTION'));
  });

  it('deletes all data only after confirmation (R10.5)', async () => {
    const declined = setup(undefined, false);
    await flush();
    button('Delete all data').click();
    await flush();
    expect(declined.calls.map((c) => c.type)).not.toContain('DELETE_ALL_DATA');

    const accepted = setup(undefined, true);
    await flush();
    button('Delete all data').click();
    await flush();
    expect(accepted.calls.map((c) => c.type)).toContain('DELETE_ALL_DATA');
    expect(document.body.textContent).toContain('All data deleted.');
  });

  it('goes back', async () => {
    const t = setup();
    await flush();
    button('Back').click();
    expect(t.onBack).toHaveBeenCalled();
  });
});
