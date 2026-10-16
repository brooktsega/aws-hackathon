# Requirements: Gmail Job Application Tracker

## Introduction

A Manifest V3 Chrome extension that helps a job seeker track applications from their Gmail inbox. When the user is viewing an email on `mail.google.com`, a content script extracts the plain text of that email. The user's side panel sends it to Claude, which identifies the **company**, **role**, and **process status** (Applied, Interview Scheduled, Rejected, …). Results are saved to `chrome.storage.local`, shown on a lightweight **Kanban board** in the side panel, and aggregated in an **interactive dashboard** with metrics (time applied, company, time rejected, time to first response) and **alerts** about upcoming events and new opportunities from firms that have emailed the user.

## Assumptions and Decisions

| # | Assumption / decision | Why |
|---|---|---|
| A1 | The Claude model ID is a **setting**, defaulting to `claude-sonnet-5-5`. | The request names "Claude 3.5 Sonnet", which is not in the current model lineup. A configurable ID keeps the extension working as models change. |
| A2 | The user supplies their own Anthropic API key. There is no backend. | Keeps the extension self-contained for a hackathon. The key lives only in extension storage and is used only by the service worker. |
| A3 | "Alerts of upcoming opportunities at the same firm that emails you" means two alert types: **(a) upcoming events** (interview, assessment, deadline, offer expiry) with a date, and **(b) new opportunities**, meaning an email from a firm that advertises or invites the user to a different or new role. | The phrase is ambiguous. Both readings are useful and both come from the same Claude call. |
| A4 | Analysis is **user-initiated** (an "Analyze this email" button). There is no background scanning of the inbox. | Minimizes data sent to a third party and keeps the Gmail permission surface small. |
| A5 | Minimum Chrome version is 114 (Side Panel API). | `chrome.sidePanel` shipped in 114. |
| A6 | Email text is processed by the Anthropic API. Nothing else leaves the browser. | Stated in the privacy requirements (R11). |

## Glossary

- **Extension**: the Chrome extension described here.
- **Content Script**: script injected only into `mail.google.com` pages.
- **Service Worker**: the MV3 background worker; the only component that calls the Claude API or touches the API key.
- **Side Panel**: the extension UI in Chrome's side panel (hosts the Analyze action, result card, Kanban board, alerts summary).
- **Dashboard**: a full-tab extension page with metrics, charts, table, and alerts.
- **Email Payload**: `{ subject, from, to, date, threadId, bodyText, truncated }` extracted from the open Gmail thread.
- **Analysis Result**: the validated JSON returned by Claude for one Email Payload.
- **Application**: a stored record for one company + role, with status and a status history.
- **Status**: one of `applied`, `screening`, `interview_scheduled`, `offer`, `rejected`, `withdrawn`.
- **Alert**: a stored notice of type `upcoming_event` or `new_opportunity`.

---

## Requirements

### R1. Extension scope and permissions

**User story:** As a user, I want the extension to touch only Gmail and the Claude API, so that I can trust what it can access.

1. The Extension shall be a Manifest V3 extension (`manifest_version: 3`) with a service worker as its only background context.
2. The Extension shall declare the Content Script with `matches` limited to `https://mail.google.com/*`.
3. The Extension shall declare `host_permissions` limited to `https://mail.google.com/*` and `https://api.anthropic.com/*`.
4. The Extension shall request only the permissions `storage`, `sidePanel`, `alarms`, and `notifications`.
5. The Extension shall not load or execute remotely hosted code.
6. When the user clicks the Extension's toolbar action, the Extension shall open the Side Panel.

### R2. Email text extraction

**User story:** As a user, I want the extension to read the email I currently have open, so that I don't have to copy and paste.

1. When the Content Script receives an `EXTRACT_EMAIL` request, the Content Script shall return an Email Payload for the Gmail conversation currently open in that tab.
2. The Content Script shall return `subject`, `from` (name and address), `to`, `date`, and `bodyText` as plain text, with HTML markup removed.
3. The Content Script shall exclude quoted reply history and signatures-in-quotes (for example `.gmail_quote` blocks) from `bodyText`.
4. When the open conversation contains several expanded messages, the Content Script shall include them in chronological order, each labeled with its sender and date.
5. If `bodyText` exceeds 12,000 characters, the Content Script shall keep the most recent content up to that limit and set `truncated: true`.
6. If no conversation is open (for example the inbox list is showing), the Content Script shall respond with the error `NO_EMAIL_OPEN`.
7. If the expected Gmail DOM elements cannot be found, the Content Script shall respond with the error `GMAIL_DOM_UNRECOGNIZED` and shall not return partial or guessed data.
8. The Content Script shall not make network requests, read `chrome.storage`, or modify the Gmail page.
9. While the active tab shows a conversation view, the Content Script shall report `isThreadView: true` to the Service Worker, and `false` otherwise, whenever the view changes.

### R3. Side panel analyze flow

**User story:** As a user, I want one click to analyze the open email, so that tracking costs me almost no effort.

1. While the active tab is a Gmail conversation view and an API key is configured, the Side Panel shall enable the "Analyze this email" button.
2. While the active tab is not a Gmail conversation view, the Side Panel shall disable the button and shall show a message explaining why.
3. While no API key is configured, the Side Panel shall show a prompt that links to Settings instead of enabling the button.
4. When the user clicks "Analyze this email", the Side Panel shall request analysis from the Service Worker and shall show a loading state until a response arrives.
5. When analysis succeeds, the Side Panel shall show a result card with company, role, status, confidence, evidence quote, any upcoming events, and any new opportunities.
6. The result card shall let the user edit company, role, and status before saving.
7. When the user clicks "Save", the Side Panel shall ask the Service Worker to persist the (possibly edited) result.
8. When the user clicks "Discard", the Side Panel shall drop the result without writing to storage.
9. If `truncated` is true, the Side Panel shall tell the user that only part of the email was analyzed.
10. If the email is not job related, the Side Panel shall say so and shall not offer to save an Application.

### R4. Claude analysis

**User story:** As a user, I want Claude to read the email and tell me which company, role, and stage it concerns.

1. When the Service Worker receives an analysis request, it shall extract the Email Payload from the sender's tab, then send it to the Claude Messages API.
2. The Service Worker shall request output constrained to a JSON schema containing at least: `emailKind`, `company`, `role`, `status`, `confidence`, `evidence`, `upcomingEvents[]`, and `opportunities[]`.
3. The Service Worker shall pass the email's date and the user's time zone to Claude so that relative dates ("next Tuesday at 2pm") resolve to absolute ISO-8601 timestamps.
4. The Service Worker shall treat email content as untrusted data: the prompt shall instruct Claude to ignore any instructions inside the email, and the Service Worker shall not give Claude any tools.
5. The Service Worker shall validate the response against the schema before using it, and shall reject any value outside the allowed `status` and `emailKind` enums.
6. Where `emailKind` is `new_opportunity`, `other_job_related`, or `not_job_related`, the Service Worker shall not change any Application's status.
7. If the API response has `stop_reason: "refusal"`, then the Service Worker shall return the error `MODEL_REFUSED` and shall not retry with the same model.
8. If the API response is cut off (`stop_reason: "max_tokens"`) or fails schema validation, then the Service Worker shall return the error `INVALID_MODEL_OUTPUT`.
9. The Service Worker shall use the model ID from Settings and shall default to `claude-sonnet-5-5`.

### R5. Application records and status history

**User story:** As a user, I want multiple emails about the same job to update one record, not create duplicates.

1. When the user saves an Analysis Result with a non-null company and role, the Service Worker shall find an existing Application with the same normalized company and a matching role.
2. If a matching Application exists, then the Service Worker shall append a status-history entry to it rather than create a new Application.
3. If no matching Application exists, then the Service Worker shall create one.
4. The Service Worker shall order status-history entries by the email's date, not by the time of analysis.
5. The Application's current `status` shall be the status of the history entry with the latest email date.
6. When the history contains an `applied` entry, the Service Worker shall set `appliedAt` to the earliest such email date.
7. If no `applied` entry exists, then the Service Worker shall set `appliedAt` to the earliest email date in the history and mark `appliedAtEstimated: true`.
8. When the history contains a `rejected` entry, the Service Worker shall set `rejectedAt` to that entry's email date.
9. If the same email (same thread and same latest message date) is saved twice, then the Service Worker shall not create a duplicate history entry.
10. If the Analysis Result has a company but a null role, then the Service Worker shall use the role "Unknown role" and let the user edit it.

### R6. Persistence

**User story:** As a user, I want my tracker to survive browser restarts and stay on my machine.

1. The Service Worker shall persist Applications, Alerts, processed-email keys, and Settings in `chrome.storage.local`.
2. The Extension shall store only extracted fields, a source-email reference, and a short evidence quote. It shall not store full email bodies.
3. The Extension shall store a `schemaVersion` and shall migrate older data forward on startup.
4. If a storage write fails, then the Service Worker shall return the error `STORAGE_WRITE_FAILED` and shall leave previously stored data unchanged.
5. When storage changes, every open Extension page shall update its view without a manual refresh.

### R7. Kanban board

**User story:** As a user, I want to see all my applications by stage at a glance.

1. The Side Panel shall show a Kanban board with the columns Applied, Screening, Interview Scheduled, Offer, and Closed.
2. The Kanban board shall place `rejected` and `withdrawn` Applications in the Closed column and shall label each with its specific status.
3. Each card shall show company, role, and the number of days since `appliedAt`.
4. When the user drags a card to another column, the Side Panel shall ask the Service Worker to set that status as a manual history entry dated now.
5. When the user opens a card's menu, the Side Panel shall offer Edit and Delete; Delete shall require confirmation.
6. While there are no Applications, the Kanban board shall show an empty state that explains how to add the first one.
7. The Kanban board shall be fully operable by keyboard, with an alternative to drag-and-drop (a "Move to…" menu).

### R8. Interactive dashboard

**User story:** As a user, I want metrics and a searchable table so that I can understand how my job search is going.

1. When the user clicks "Open dashboard" in the Side Panel, the Extension shall open the Dashboard in a new tab (or focus the existing one).
2. The Dashboard shall show these metric tiles: total applications, active applications, response rate, median days from applied to first response, median days from applied to rejection, and rejection count.
3. The Dashboard shall show a chart of applications per week and a status funnel.
4. The Dashboard shall show a table with columns: Company, Role, Status, Applied (date), Days since applied, Last update, and Rejected (date, or "—").
5. When the user clicks a column header, the Dashboard shall sort the table by that column and toggle the sort direction.
6. The Dashboard shall let the user filter by status and date range and search by company or role; metrics, charts, and table shall all reflect the active filters.
7. When the user clicks a table row, the Dashboard shall open a detail panel with the full status timeline and source-email links.
8. Each source-email link shall open the conversation in Gmail in a new tab.
9. When the user clicks "Export CSV", the Dashboard shall download the currently filtered table as a CSV file.
10. If an Application has `appliedAtEstimated: true`, then the Dashboard shall mark its applied date as estimated.
11. The Dashboard shall render charts without remote scripts, fonts, or images.

### R9. Alerts: upcoming events and new opportunities

**User story:** As a user, I want to be told about interviews and deadlines coming up and about new roles from firms already in touch with me.

1. When an Analysis Result contains an upcoming event with a future `startsAt`, the Service Worker shall store an `upcoming_event` Alert linked to the Application.
2. When an Analysis Result has `emailKind: "new_opportunity"`, the Service Worker shall store a `new_opportunity` Alert with the company, the opportunity title, and the source email.
3. If the alert's company matches an existing Application's company, then the Service Worker shall mark the Alert `firmKnown: true`.
4. The Dashboard and Side Panel shall list active Alerts, with `firmKnown` new-opportunity Alerts and the soonest upcoming events first.
5. When an `upcoming_event` is within 24 hours, the Service Worker shall raise a Chrome notification once, using an alarm.
6. When the user dismisses an Alert, the Extension shall mark it dismissed and shall not show or notify for it again.
7. When an event's time has passed, the Extension shall move its Alert to a "Past" state automatically.
8. The Extension shall show the count of undismissed, non-past Alerts as the toolbar badge text.
9. If the same event (same company, type, and start time) is saved twice, then the Service Worker shall keep only one Alert.
10. If a later email for the same Application has the status `rejected` or `withdrawn`, then the Service Worker shall dismiss that Application's open `upcoming_event` Alerts.

### R10. Settings and API key

**User story:** As a user, I want to control the key and model.

1. The Side Panel shall provide a Settings view where the user enters, replaces, and clears their Anthropic API key.
2. The Settings view shall show the key only masked after saving.
3. The Settings view shall let the user choose the model ID (default `claude-sonnet-5-5`).
4. When the user clicks "Test connection", the Service Worker shall make a minimal request and report success or the specific failure.
5. The Settings view shall provide "Delete all data", which requires confirmation and clears Applications, Alerts, and processed-email keys.
6. The Extension shall restrict `chrome.storage.local` to trusted contexts (`TRUSTED_CONTEXTS`) so the Content Script cannot read the API key.

### R11. Privacy and security

**User story:** As a user, I want to know exactly what leaves my browser.

1. The Extension shall send email content only to `https://api.anthropic.com`, and only after the user clicks "Analyze this email".
2. The Extension shall show a one-time disclosure before the first analysis stating that the open email's text is sent to Anthropic.
3. The Extension shall not include the API key, other emails, or other tabs' content in any request.
4. The Extension shall not log email content or the API key to the console in production builds.
5. The Extension shall render all extracted and model-provided strings as text, not HTML.
6. The Extension shall declare a restrictive CSP for extension pages (`script-src 'self'`).

### R12. Error handling and resilience

**User story:** As a user, I want clear messages when something goes wrong.

1. The Extension shall map each failure to a user-readable message with a suggested action: `NO_API_KEY`, `NO_EMAIL_OPEN`, `GMAIL_DOM_UNRECOGNIZED`, `AUTH_FAILED` (HTTP 401/403), `RATE_LIMITED` (429), `API_UNAVAILABLE` (5xx or network), `MODEL_REFUSED`, `INVALID_MODEL_OUTPUT`, `STORAGE_WRITE_FAILED`.
2. If the API returns 429 or a 5xx, then the Service Worker shall retry up to two times with backoff before returning the error.
3. If the Content Script does not respond within 5 seconds, then the Service Worker shall return an error asking the user to reload the Gmail tab.
4. If the Service Worker restarts mid-request, then the Side Panel shall show a retryable error and no partial record shall be saved.
5. While a request is in flight, the Side Panel shall prevent a second concurrent analysis.

### R13. Non-functional

1. The Side Panel shall show the Kanban board within 300 ms of opening for up to 500 Applications.
2. The Extension's UI shall meet WCAG 2.1 AA color contrast and shall be keyboard operable.
3. The Extension's UI shall follow the browser's light and dark color scheme.
4. The Extension shall add no runtime dependencies beyond the Anthropic SDK; charts and Kanban shall be hand-written.
5. All domain logic (normalization, merge, metrics, alerts, Gmail parsing, schema validation) shall be pure functions with unit tests.

---

## Out of Scope (v1)

- Background or bulk scanning of the inbox; Gmail API / OAuth.
- Other mail providers; Firefox/Safari.
- Syncing across devices (`chrome.storage.sync`); a hosted backend.
- Sending email or drafting replies.
- Pre-filling or submitting job applications.
