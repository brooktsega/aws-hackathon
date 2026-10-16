// Message catalogue (design §4.2). Each entry maps a message type to its
// request payload and the `data` of its successful Result.
import type {
  AnalysisEdits,
  AnalysisPreview,
  EmailPayload,
  Result,
  SettingsView,
  Status,
  ViewState,
} from './types';

export const MESSAGE_TYPES = [
  'EXTRACT_EMAIL',
  'VIEW_CHANGED',
  'ANALYZE_ACTIVE_EMAIL',
  'SAVE_ANALYSIS',
  'SET_STATUS_MANUAL',
  'UPDATE_APPLICATION',
  'DELETE_APPLICATION',
  'DISMISS_ALERT',
  'GET_SETTINGS',
  'SAVE_SETTINGS',
  'TEST_CONNECTION',
  'DELETE_ALL_DATA',
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

export interface MessageMap {
  /** Service worker -> content script (tabs.sendMessage). */
  EXTRACT_EMAIL: { payload: undefined; data: EmailPayload };
  /** Content script -> service worker. Fire-and-forget. */
  VIEW_CHANGED: { payload: ViewState; data: void };
  /** Side panel -> service worker. Does not save (R4.1). */
  ANALYZE_ACTIVE_EMAIL: { payload: undefined; data: AnalysisPreview };
  /** `applicationId` is null when the email produced only alerts. */
  SAVE_ANALYSIS: {
    payload: { preview: AnalysisPreview; edits: AnalysisEdits };
    data: { applicationId: string | null };
  };
  SET_STATUS_MANUAL: { payload: { applicationId: string; status: Status }; data: void };
  UPDATE_APPLICATION: {
    payload: { applicationId: string; fields: { company?: string; role?: string } };
    data: void;
  };
  DELETE_APPLICATION: { payload: { applicationId: string }; data: void };
  DISMISS_ALERT: { payload: { alertId: string }; data: void };
  GET_SETTINGS: { payload: undefined; data: SettingsView };
  /** Fields omitted are left unchanged; `apiKey: ''` clears the key (R10.1). */
  SAVE_SETTINGS: {
    payload: { apiKey?: string; model?: string; disclosureAccepted?: boolean };
    data: SettingsView;
  };
  TEST_CONNECTION: { payload: undefined; data: void };
  DELETE_ALL_DATA: { payload: undefined; data: void };
}

export type MessagePayload<T extends MessageType> = MessageMap[T]['payload'];
export type MessageData<T extends MessageType> = MessageMap[T]['data'];

/** A request as sent over chrome.runtime / chrome.tabs messaging. */
export type MessageRequest<T extends MessageType = MessageType> = {
  [K in T]: MessageMap[K]['payload'] extends undefined
    ? { type: K; payload?: undefined }
    : { type: K; payload: MessageMap[K]['payload'] };
}[T];

export type MessageResponse<T extends MessageType> = Result<MessageData<T>>;
