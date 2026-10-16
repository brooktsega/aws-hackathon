// Maps SDK errors and unusable responses to app error codes (R4.7–R4.8, R12.1, design §6.3).
// Error text from the API is never forwarded: it is not user-actionable and could echo request details.
import Anthropic from '@anthropic-ai/sdk';
import { ERROR_INFO } from '../shared/errors';
import type { AppError, ErrorCode } from '../shared/types';

const appError = (code: ErrorCode): AppError => ({ code, message: ERROR_INFO[code].message });

export function mapApiError(error: unknown): AppError {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return appError('AUTH_FAILED');
  }
  if (error instanceof Anthropic.RateLimitError) return appError('RATE_LIMITED');
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError || error instanceof Anthropic.UnprocessableEntityError) {
    return appError('REQUEST_REJECTED');
  }
  if (error instanceof Anthropic.APIConnectionError) return appError('API_UNAVAILABLE'); // includes timeouts
  if (error instanceof Anthropic.APIError) {
    // 5xx and 529 (overloaded). Anything else unexpected is reported as retryable.
    return appError(error.status !== undefined && error.status >= 500 ? 'API_UNAVAILABLE' : 'INTERNAL');
  }
  return appError('INTERNAL');
}

export interface ResponseLike {
  stop_reason: string | null;
}

/**
 * Checks `stop_reason` before the content is read. Returns an error for a
 * refusal (never retried on the same model) or a truncated answer.
 */
export function checkStopReason(response: ResponseLike): AppError | null {
  if (response.stop_reason === 'refusal') return appError('MODEL_REFUSED');
  if (response.stop_reason === 'max_tokens') return appError('INVALID_MODEL_OUTPUT');
  return null;
}
