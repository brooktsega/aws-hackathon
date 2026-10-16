# Gmail Job Tracker (Chrome extension)

Reads the Gmail email you have open, asks Claude for the company, role, and status, and tracks your applications on a Kanban board and dashboard. Spec: `.kiro/specs/gmail-tracker/`.

## Install

### Option 1: download the ready-made build (no tools needed)

1. Download [`download/gmail-job-tracker.zip`](download/gmail-job-tracker.zip) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the unzipped folder (the one that contains `manifest.json`).
3. Click the toolbar icon to open the side panel, open **⚙ Settings**, paste your own Anthropic API key, and click **Save**.

### Option 2: build from source

1. `npm install && npm run build`
2. Load unpacked as above, choosing this folder's `dist/`.

Requires Chrome 116 or later and your own Anthropic API key (from console.anthropic.com).

To refresh the download after changing the code, run `npm run build`, then zip the contents of `dist/` into `download/gmail-job-tracker.zip`.

## Use it

1. Open a job email in Gmail (reload any Gmail tab that was open before you installed).
2. In the side panel, click **Analyze this email**, check the result, and click **Save**.
3. The application appears on the board. Use the **⋯** menu or drag cards to change status. **Dashboard** opens metrics, charts, a sortable table, alerts, and CSV export.

## Privacy

Only the email you choose to analyze is sent, to Anthropic's API, using your key. Everything else stays in this browser. The key is stored unencrypted in this browser profile.

## Known limits

- Not yet tested against live Gmail. If you see "Couldn't read this Gmail view", Gmail's markup differs from what the parser expects; the selectors are all in `src/content/gmail-selectors.ts`.
- Development: `npm test`, `npm run lint`, `npm run typecheck`.
