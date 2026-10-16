// Settings view: API key, model, connection test, delete all data (R10, R11).
import type { send as sendFn } from '../shared/client';
import { DEFAULT_MODEL } from '../shared/constants';
import { ERROR_INFO } from '../shared/errors';
import type { SettingsView } from '../shared/types';
import { confirmDialog } from '../ui/dialog';
import { h, render } from '../ui/dom';

export interface SettingsDeps {
  send: typeof sendFn;
  onBack(): void;
  /** Called after settings change so the rest of the UI can refresh. */
  onChanged(settings: SettingsView): void;
  confirm?: typeof confirmDialog;
}

export function createSettingsView({ send, onBack, onChanged, confirm = confirmDialog }: SettingsDeps): HTMLElement {
  const root = h('div', { className: 'section' });
  const status = h('p', { className: 'small', role: 'status', 'aria-live': 'polite' });
  let current: SettingsView | null = null;

  const say = (text: string, isError = false): void => {
    status.textContent = text;
    status.className = isError ? 'small notice notice-error' : 'small muted';
  };

  async function load(): Promise<void> {
    const r = await send({ type: 'GET_SETTINGS' });
    if (!r.ok) {
      render(root, h('p', null, ERROR_INFO[r.error.code].message), h('button', { type: 'button', className: 'btn', on: { click: onBack } }, 'Back'));
      return;
    }
    current = r.data;
    draw();
  }

  function draw(): void {
    const settings = current as SettingsView;
    const keyInput = h('input', { id: 'settings-key', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: settings.hasKey ? `Saved (ends in ${settings.keyLast4 ?? '····'})` : 'sk-ant-…' });
    const modelInput = h('input', { id: 'settings-model', type: 'text', value: settings.model, autocomplete: 'off', spellcheck: 'false' });

    const save = h('button', { type: 'button', className: 'btn btn-primary', on: { click: () => void onSave() } }, 'Save');
    const test = h('button', { type: 'button', className: 'btn', on: { click: () => void onTest() } }, 'Test connection');
    const clearKey = h('button', { type: 'button', className: 'btn', disabled: !settings.hasKey, on: { click: () => void onClearKey() } }, 'Remove key');
    const wipe = h('button', { type: 'button', className: 'btn btn-danger', on: { click: () => void onWipe() } }, 'Delete all data');

    async function apply(payload: { apiKey?: string; model?: string }): Promise<boolean> {
      const r = await send({ type: 'SAVE_SETTINGS', payload });
      if (!r.ok) {
        say(r.error.message, true);
        return false;
      }
      current = r.data;
      onChanged(r.data);
      return true;
    }

    async function onSave(): Promise<void> {
      const payload: { apiKey?: string; model?: string } = {};
      if (keyInput.value.trim() !== '') payload.apiKey = keyInput.value.trim();
      const model = modelInput.value.trim();
      if (model !== settings.model) payload.model = model || DEFAULT_MODEL;
      if (Object.keys(payload).length === 0) return say('Nothing to save.');
      if (await apply(payload)) {
        draw();
        say('Saved.');
      }
    }

    async function onClearKey(): Promise<void> {
      if (await apply({ apiKey: '' })) {
        draw();
        say('Key removed.');
      }
    }

    async function onTest(): Promise<void> {
      test.disabled = true;
      say('Testing…');
      // Test what is saved, so save pending edits first.
      const pending: { apiKey?: string; model?: string } = {};
      if (keyInput.value.trim() !== '') pending.apiKey = keyInput.value.trim();
      if (modelInput.value.trim() !== settings.model) pending.model = modelInput.value.trim() || DEFAULT_MODEL;
      if (Object.keys(pending).length > 0 && !(await apply(pending))) {
        test.disabled = false;
        return;
      }
      const r = await send({ type: 'TEST_CONNECTION' });
      test.disabled = false;
      if (r.ok) say('Connection works.');
      else say(r.error.code === 'INVALID_REQUEST' ? r.error.message : ERROR_INFO[r.error.code].message, true);
    }

    async function onWipe(): Promise<void> {
      const ok = await confirm({
        title: 'Delete all data?',
        message: 'This permanently deletes every tracked application, alert, and processed-email record from this browser. Your API key and settings are kept.',
        confirmLabel: 'Delete everything',
        danger: true,
      });
      if (!ok) return;
      const r = await send({ type: 'DELETE_ALL_DATA' });
      say(r.ok ? 'All data deleted.' : ERROR_INFO[r.error.code].message, !r.ok);
    }

    render(
      root,
      h('div', { className: 'section-title' }, h('h2', null, 'Settings'), h('button', { type: 'button', className: 'btn', on: { click: onBack } }, 'Back')),
      h('div', { className: 'field' }, h('label', { for: 'settings-key' }, 'Anthropic API key'), keyInput,
        h('p', { className: 'muted small' }, 'Stored unencrypted in this browser profile and used only by the extension’s background worker. Leave blank to keep the current key.')),
      h('div', { className: 'field' }, h('label', { for: 'settings-model' }, 'Model'), modelInput,
        h('p', { className: 'muted small' }, `Default: ${DEFAULT_MODEL}. The model must support structured outputs.`)),
      h('div', { className: 'row' }, save, test, clearKey),
      status,
      h('hr'),
      h('h3', null, 'Your data'),
      h('p', { className: 'muted small' }, 'Applications and alerts are stored only in this browser. The only thing sent elsewhere is the text of an email you choose to analyze, which goes to Anthropic.'),
      wipe,
    );
  }

  render(root, h('p', { className: 'muted' }, 'Loading…'));
  void load();
  return root;
}
