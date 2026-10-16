# Gmail Job Tracker (Chrome extension)

Reads the Gmail email you have open, asks Claude for the company, role, and status, and tracks your applications on a Kanban board and dashboard. Spec: `.kiro/specs/gmail-tracker/`.

## Load it in Chrome (about 2 minutes)

1. Build (skip if `dist/` already exists): `npm install && npm run build`
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose this folder's `dist/`.
3. Click the toolbar icon to open the side panel, open **⚙ Settings**, paste your Anthropic API key, and click **Save**.

Requires Chrome 116 or later.

## Use it

1. Open a job email in Gmail (reload any Gmail tab that was open before you installed).
2. In the side panel, click **Analyze this email**, check the result, and click **Save**.
3. The application appears on the board. Use the **⋯** menu or drag cards to change status. **Dashboard** opens metrics, charts, a sortable table, alerts, and CSV export.

## Privacy

Only the email you choose to analyze is sent, to Anthropic's API, using your key. Everything else stays in this browser. The key is stored unencrypted in this browser profile.

## Known limits

- Not yet tested against live Gmail. If you see "Couldn't read this Gmail view", Gmail's markup differs from what the parser expects; the selectors are all in `src/content/gmail-selectors.ts`.
- Development: `npm test`, `npm run lint`, `npm run typecheck`.
