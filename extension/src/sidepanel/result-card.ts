// Result card shown after analysis: editable company/role/status, evidence, events,
// opportunities, with Save and Discard (R3.5–R3.10).
import { EMAIL_KIND_LABELS, STATUSES, STATUS_LABELS } from '../shared/constants';
import type { AnalysisEdits, AnalysisPreview, Result, Status } from '../shared/types';
import { h, render } from '../ui/dom';
import { formatDateTime } from '../ui/format';

export interface ResultCardHandlers {
  onSave(edits: AnalysisEdits): Promise<Result<unknown>>;
  onDiscard(): void;
}

let counter = 0;

export function createResultCard(preview: AnalysisPreview, handlers: ResultCardHandlers): HTMLElement {
  const { analysis } = preview;
  const id = `rc${++counter}`;
  const root = h('div', { className: 'card', 'aria-label': 'Analysis result' });
  const message = h('p', { className: 'small', role: 'status', 'aria-live': 'polite' });

  const kindChip = h('span', { className: 'chip chip-neutral' }, EMAIL_KIND_LABELS[analysis.emailKind]);
  const confidence = h('span', { className: `chip ${analysis.confidence === 'low' ? 'chip-warn' : 'chip-neutral'}` }, `Confidence: ${analysis.confidence}`);
  const header = h('div', { className: 'row' }, kindChip, confidence);
  const notices: HTMLElement[] = [];
  if (preview.truncated) {
    notices.push(h('p', { className: 'notice small' }, 'This email was long, so only the most recent part was analyzed.'));
  }

  const discard = h('button', { type: 'button', className: 'btn', on: { click: () => handlers.onDiscard() } }, 'Discard');

  // R3.10: nothing to save for unrelated email.
  if (analysis.emailKind === 'not_job_related') {
    render(root, header, h('p', null, "This email doesn't look job related, so there is nothing to track."), h('div', { className: 'row' }, discard));
    return root;
  }

  const company = h('input', { id: `${id}-company`, type: 'text', value: analysis.company ?? '', autocomplete: 'off' });
  const role = h('input', { id: `${id}-role`, type: 'text', value: analysis.role ?? '', autocomplete: 'off' });
  const status = h(
    'select',
    { id: `${id}-status` },
    h('option', { value: '' }, 'No status change'),
    ...STATUSES.map((s) => h('option', { value: s, selected: s === analysis.status }, STATUS_LABELS[s])),
  );

  const hasAlerts =
    analysis.upcomingEvents.some((e) => e.startsAt !== null) ||
    (analysis.emailKind === 'new_opportunity' && analysis.opportunities.length > 0);

  const save = h('button', { type: 'button', className: 'btn btn-primary', on: { click: () => void onSave() } }, 'Save');

  const readEdits = (): AnalysisEdits => ({
    company: company.value.trim() || null,
    role: role.value.trim() || null,
    status: (status.value || null) as Status | null,
  });

  function refresh(): void {
    const edits = readEdits();
    const tracksApplication = edits.status !== null;
    save.textContent = tracksApplication ? 'Save' : 'Save alerts';
    const canSave = tracksApplication ? edits.company !== null : hasAlerts;
    save.disabled = !canSave;
    if (!canSave && !message.textContent) {
      message.textContent = tracksApplication ? 'Enter a company to save.' : 'Nothing to save: choose a status to track this email.';
    }
  }

  async function onSave(): Promise<void> {
    save.disabled = true;
    discard.disabled = true;
    message.className = 'small muted';
    message.textContent = 'Saving…';
    const r = await handlers.onSave(readEdits());
    if (!r.ok) {
      message.className = 'small notice notice-error';
      message.textContent = r.error.message;
      discard.disabled = false;
      refresh();
    }
  }

  for (const el of [company, role, status]) {
    el.addEventListener('input', () => {
      message.textContent = '';
      refresh();
    });
  }

  const events = analysis.upcomingEvents.length
    ? h('div', null, h('h3', null, 'Upcoming'), h('ul', null, ...analysis.upcomingEvents.map((e) => {
        const when = e.startsAt && !Number.isNaN(Date.parse(e.startsAt)) ? formatDateTime(Date.parse(e.startsAt)) : 'time not given';
        return h('li', null, `${e.title || e.type} (${e.type.replace('_', ' ')}), ${when}`);
      })))
    : null;
  const opportunities = analysis.opportunities.length
    ? h('div', null, h('h3', null, 'Opportunities'), h('ul', null, ...analysis.opportunities.map((o) => h('li', null, o.location ? `${o.title} (${o.location})` : o.title))))
    : null;

  render(
    root,
    header,
    ...notices,
    h('div', { className: 'field' }, h('label', { for: `${id}-company` }, 'Company'), company),
    h('div', { className: 'field' }, h('label', { for: `${id}-role` }, 'Role'), role),
    h('div', { className: 'field' }, h('label', { for: `${id}-status` }, 'Status'), status),
    analysis.evidence ? h('blockquote', { className: 'evidence' }, analysis.evidence) : null,
    events,
    opportunities,
    h('div', { className: 'row' }, save, discard),
    message,
  );
  refresh();
  return root;
}
