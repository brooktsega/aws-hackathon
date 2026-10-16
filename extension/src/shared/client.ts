// How extension pages talk to the service worker. Always resolves to a Result.
import type { MessageRequest, MessageResponse, MessageType } from './messages';

export async function send<T extends MessageType>(request: MessageRequest<T>): Promise<MessageResponse<T>> {
  try {
    const reply = (await chrome.runtime.sendMessage(request)) as MessageResponse<T> | undefined;
    if (reply && typeof reply === 'object' && 'ok' in reply) return reply;
    return { ok: false, error: { code: 'INTERNAL', message: 'No response from the extension.' } };
  } catch {
    // e.g. the worker was restarted mid-request (R12.4): retryable.
    return { ok: false, error: { code: 'INTERNAL', message: 'The extension was interrupted. Please try again.' } };
  }
}
