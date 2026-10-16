// User-facing text for every error code (R12.1, design §13).
import type { ErrorCode } from './types';

export type ErrorAction = 'open_settings' | 'retry' | 'reload_tab' | 'none';

export interface ErrorInfo {
  message: string;
  action: ErrorAction;
}

export const ERROR_INFO: Record<ErrorCode, ErrorInfo> = {
  NO_API_KEY: { message: 'Add your Anthropic API key to get started.', action: 'open_settings' },
  NO_EMAIL_OPEN: { message: 'Open an email in Gmail first.', action: 'none' },
  GMAIL_DOM_UNRECOGNIZED: {
    message: "Couldn't read this Gmail view. Reload the tab; if it keeps happening, Gmail may have changed.",
    action: 'reload_tab',
  },
  CONTENT_SCRIPT_UNREACHABLE: { message: 'Reload your Gmail tab, then try again.', action: 'reload_tab' },
  AUTH_FAILED: { message: 'Your API key was rejected. Check it in Settings.', action: 'open_settings' },
  RATE_LIMITED: { message: 'Too many requests. Wait a moment and try again.', action: 'retry' },
  API_UNAVAILABLE: { message: "Claude couldn't be reached. Check your connection and try again.", action: 'retry' },
  MODEL_REFUSED: {
    message: 'Claude declined to analyze this email. You can add it manually, or try another model in Settings.',
    action: 'none',
  },
  INVALID_MODEL_OUTPUT: { message: "Couldn't understand Claude's response. Try again.", action: 'retry' },
  STORAGE_WRITE_FAILED: { message: "Couldn't save. Your existing data is unchanged.", action: 'retry' },
  REQUEST_REJECTED: {
    message: 'Claude rejected the request. Check the model name in Settings and your account credit.',
    action: 'open_settings',
  },
  DISCLOSURE_REQUIRED: {
    message: "Confirm that the open email's text may be sent to Anthropic before analyzing.",
    action: 'open_settings',
  },
  ANALYSIS_IN_PROGRESS: { message: 'An analysis is already running.', action: 'none' },
  INVALID_REQUEST: { message: 'Something was wrong with that request.', action: 'none' },
  INTERNAL: { message: 'Something went wrong. Please try again.', action: 'retry' },
};
