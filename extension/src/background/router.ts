// Message router (design §4). Dispatches by message type, always answers with a
// Result, and never lets a handler exception escape or leak details.
import { MESSAGE_TYPES } from '../shared/messages';
import type { MessageData, MessagePayload, MessageType } from '../shared/messages';
import type { Result } from '../shared/types';

type Sender = Pick<chrome.runtime.MessageSender, 'id' | 'url' | 'tab'>;

export type Handler<T extends MessageType> = (
  payload: MessagePayload<T>,
  sender: Sender,
) => Promise<Result<MessageData<T>>>;

export type Handlers = { [K in MessageType]?: Handler<K> };

const GMAIL_ORIGIN = 'https://mail.google.com/';

const fail = (code: 'INVALID_REQUEST' | 'INTERNAL', message: string): Result<never> => ({
  ok: false,
  error: { code, message },
});

/**
 * Content scripts run inside Gmail, a page we do not control, so they may only
 * report view state. Every other message must come from our own pages.
 */
function allowed(type: MessageType, sender: Sender, ownId: string | undefined): boolean {
  if (ownId !== undefined && sender.id !== undefined && sender.id !== ownId) return false;
  const fromGmail = sender.url?.startsWith(GMAIL_ORIGIN) ?? false;
  return !fromGmail || type === 'VIEW_CHANGED';
}

export function createRouter(handlers: Handlers, ownId?: string) {
  return async function route(message: unknown, sender: Sender): Promise<Result<unknown>> {
    if (typeof message !== 'object' || message === null) return fail('INVALID_REQUEST', 'Malformed message.');
    const { type, payload } = message as { type?: unknown; payload?: unknown };
    if (typeof type !== 'string' || !(MESSAGE_TYPES as readonly string[]).includes(type)) {
      return fail('INVALID_REQUEST', 'Unknown message type.');
    }
    const t = type as MessageType;
    if (!allowed(t, sender, ownId)) return fail('INVALID_REQUEST', 'This sender may not send that message.');

    const handler = handlers[t] as ((p: unknown, s: Sender) => Promise<Result<unknown>>) | undefined;
    if (!handler) return fail('INVALID_REQUEST', 'This message is not handled here.');
    try {
      return await handler(payload, sender);
    } catch {
      return fail('INTERNAL', 'Something went wrong. Please try again.');
    }
  };
}

/** Registers the router on chrome.runtime.onMessage. Call synchronously at worker top level. */
export function registerRouter(handlers: Handlers): void {
  const route = createRouter(handlers, chrome.runtime.id);
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void route(message, sender).then(sendResponse);
    return true; // keep the channel open for the async reply
  });
}
