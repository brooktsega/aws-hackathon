// ANALYZE_ACTIVE_EMAIL orchestration (R4.1, R3.4, R11, R12.5, design §4.3):
// check key + disclosure, take the in-flight lock, extract, ask Claude, return a
// preview. Nothing is saved here; saving is a separate, user-confirmed step.
import type { AnalysisPreview, EmailMeta, EmailPayload, Result } from '../shared/types';
import { ERROR_INFO } from '../shared/errors';
import { analyzeEmail } from './claude';
import type { MessagesClient } from './claude';
import { withLock } from './lock';
import type { Handler } from './router';
import type { KeyValueArea, Store } from './storage';

export interface AnalyzeDeps {
  store: Store;
  /** storage.session, for the in-flight lock. */
  session: KeyValueArea;
  extract(): Promise<Result<EmailPayload>>;
  createClient(apiKey: string): MessagesClient;
  now(): number;
  timeZone(): string;
}

export function toEmailMeta(email: EmailPayload): EmailMeta {
  return {
    subject: email.subject,
    from: email.from,
    to: email.to,
    date: email.date,
    threadId: email.threadId,
    messageKey: email.messageKey,
  };
}

export function createAnalyzeHandler(deps: AnalyzeDeps): Handler<'ANALYZE_ACTIVE_EMAIL'> {
  return async () => {
    const { settings } = await deps.store.load();
    if (!settings.apiKey) {
      return { ok: false, error: { code: 'NO_API_KEY', message: ERROR_INFO.NO_API_KEY.message } };
    }
    // Defense in depth for R11.2: even if the UI is bypassed, no email text leaves before consent.
    if (!settings.disclosureAccepted) {
      return { ok: false, error: { code: 'DISCLOSURE_REQUIRED', message: ERROR_INFO.DISCLOSURE_REQUIRED.message } };
    }
    const apiKey = settings.apiKey;

    return withLock(deps.session, deps.now(), async (): Promise<Result<AnalysisPreview>> => {
      const extracted = await deps.extract();
      if (!extracted.ok) return extracted;
      const email = extracted.data;

      const analyzed = await analyzeEmail(deps.createClient(apiKey), settings.model, email, deps.timeZone());
      if (!analyzed.ok) return analyzed;

      return {
        ok: true,
        data: { email: toEmailMeta(email), analysis: analyzed.data, truncated: email.truncated },
      };
    });
  };
}
