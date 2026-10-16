// Settings handlers (R10, design §12). The API key goes in and never comes back out:
// the UI only ever receives `hasKey` and the last four characters.
import { DEFAULT_MODEL } from '../shared/constants';
import { ERROR_INFO } from '../shared/errors';
import type { AppError, Result, Settings, SettingsView } from '../shared/types';
import { mapApiError } from './claude-errors';
import type { MessagesClient } from './claude';
import type { Handler } from './router';
import type { Store } from './storage';

export function toSettingsView(settings: Settings): SettingsView {
  const view: SettingsView = {
    hasKey: Boolean(settings.apiKey),
    model: settings.model,
    disclosureAccepted: settings.disclosureAccepted,
  };
  if (settings.apiKey) view.keyLast4 = settings.apiKey.slice(-4);
  return view;
}

const bad = (message: string): { ok: false; error: AppError } => ({ ok: false, error: { code: 'INVALID_REQUEST', message } });

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const KEY_PATTERN = /^\S{20,500}$/;

export interface SettingsDeps {
  store: Store;
  createClient(apiKey: string): MessagesClient;
}

export function createGetSettingsHandler({ store }: SettingsDeps): Handler<'GET_SETTINGS'> {
  return async () => ({ ok: true, data: toSettingsView((await store.load()).settings) });
}

export function createSaveSettingsHandler({ store }: SettingsDeps): Handler<'SAVE_SETTINGS'> {
  return async (payload) => {
    if (typeof payload !== 'object' || payload === null) return bad('Malformed settings.');
    const { apiKey, model, disclosureAccepted } = payload;
    if (apiKey !== undefined && (typeof apiKey !== 'string' || (apiKey.trim() !== '' && !KEY_PATTERN.test(apiKey.trim())))) {
      return bad("That doesn't look like an API key.");
    }
    if (model !== undefined && (typeof model !== 'string' || !MODEL_PATTERN.test(model.trim()))) {
      return bad('That is not a valid model name.');
    }
    if (disclosureAccepted !== undefined && typeof disclosureAccepted !== 'boolean') return bad('Malformed settings.');

    const result = await store.transaction((state) => {
      const next: Settings = { ...state.settings };
      if (apiKey !== undefined) {
        if (apiKey.trim() === '') delete next.apiKey;
        else next.apiKey = apiKey.trim();
      }
      if (model !== undefined) next.model = model.trim();
      if (disclosureAccepted !== undefined) next.disclosureAccepted = disclosureAccepted;
      return { ok: true as const, state: { ...state, settings: next }, result: toSettingsView(next) };
    });
    return result;
  };
}

/** One tiny request that proves the key, model, and network path work (R10.4). */
export function createTestConnectionHandler({ store, createClient }: SettingsDeps): Handler<'TEST_CONNECTION'> {
  return async (): Promise<Result<void>> => {
    const { settings } = await store.load();
    if (!settings.apiKey) return { ok: false, error: { code: 'NO_API_KEY', message: ERROR_INFO.NO_API_KEY.message } };
    try {
      const response = await createClient(settings.apiKey).messages.create({
        model: settings.model || DEFAULT_MODEL,
        max_tokens: 256,
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        output_config: { effort: 'low' },
      });
      if (response.stop_reason === 'refusal') return { ok: false, error: { code: 'MODEL_REFUSED', message: ERROR_INFO.MODEL_REFUSED.message } };
      return { ok: true, data: undefined };
    } catch (error) {
      return { ok: false, error: mapApiError(error) };
    }
  };
}

/** Clears applications, alerts, and processed-email keys; keeps the API key and settings (R10.5). */
export function createDeleteAllDataHandler({ store }: SettingsDeps): Handler<'DELETE_ALL_DATA'> {
  return async () =>
    store.transaction((state) => ({
      ok: true,
      state: { ...state, applications: {}, alerts: {}, processed: {} },
      result: undefined,
    }));
}
