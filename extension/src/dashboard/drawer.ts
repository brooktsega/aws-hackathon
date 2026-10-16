// Application detail drawer: timeline with source-email links, manual status, edit, delete (R8.7, R8.8, R7.5).
import { STATUSES, STATUS_LABELS } from '../shared/constants';
import type { Application, Status } from '../shared/types';
import { editDialog } from '../sidepanel/kanban';
import { confirmDialog } from '../ui/dialog';
import { h } from '../ui/dom';
import { formatDate, formatDateTime } from '../ui/format';

export interface DrawerActions {
  setStatus(id: string, status: Status): Promise<void>;
  edit(id: string, fields: { company: string; role: string }): Promise<void>;
  remove(id: string): Promise<void>;
  onClose(): void;
}

/** Link to the conversation in Gmail, only for ids that are safe to place in a URL. */
export function gmailThreadUrl(threadId: string | undefined): string | null {
  return threadId && /^[A-Za-z0-9_-]{8,}$/.test(threadId) ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}` : null;
}

export function createDrawer(app: Application, actions: DrawerActions): HTMLElement {
  const titleId = 'drawer-title';
  const closeBtn = h('button', { type: 'button', className: 'btn', on: { click: actions.onClose } }, 'Close');

  const facts: [string, string][] = [
    ['Applied', `${formatDate(app.appliedAt)}${app.appliedAtEstimated ? ' (estimated)' : ''}`],
    ['First response', app.firstResponseAt !== undefined ? formatDate(app.firstResponseAt) : '—'],
    ['Rejected', app.rejectedAt !== undefined ? formatDate(app.rejectedAt) : '—'],
    ['Last update', formatDate(app.lastUpdateAt)],
  ];

  const statusSelect = h('select', { id: 'drawer-status', 'aria-label': 'Set status' },
    ...STATUSES.map((s) => h('option', { value: s, selected: s === app.status }, STATUS_LABELS[s])));
  statusSelect.addEventListener('change', () => void actions.setStatus(app.id, statusSelect.value as Status));

  const timeline = h('ol', { className: 'timeline', 'aria-label': 'Status history' }, ...[...app.history].reverse().map((e) => {
    const url = gmailThreadUrl(e.threadId);
    return h('li', null,
      h('div', null, h('span', { className: 'chip', dataset: { status: e.status } }, STATUS_LABELS[e.status]), ' ', h('span', { className: 'small muted' }, formatDateTime(e.at))),
      e.source === 'manual' ? h('div', { className: 'small muted' }, 'Set manually') : null,
      e.subject ? h('div', { className: 'small' }, e.subject) : null,
      e.evidence ? h('blockquote', { className: 'evidence small' }, e.evidence) : null,
      url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', className: 'small' }, 'Open in Gmail') : null);
  }));

  const panel = h('aside', { className: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { className: 'row', style: 'justify-content:space-between' },
      h('div', null, h('h2', { id: titleId }, app.company), h('div', { className: 'muted' }, app.role)), closeBtn),
    h('dl', { style: 'display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:12px 0' },
      ...facts.flatMap(([k, v]) => [h('dt', { className: 'muted' }, k), h('dd', { style: 'margin:0' }, v)])),
    h('div', { className: 'field' }, h('label', { for: 'drawer-status' }, 'Status'), statusSelect),
    h('h3', null, 'Timeline'), timeline,
    h('div', { className: 'row', style: 'margin-top:12px' },
      h('button', { type: 'button', className: 'btn', on: { click: () => void editDialog(app).then((f) => f && actions.edit(app.id, f)) } }, 'Edit…'),
      h('button', { type: 'button', className: 'btn btn-danger', on: { click: () => void confirmDialog({ title: 'Delete application?', message: `${app.company} — ${app.role} and its alerts will be removed.`, confirmLabel: 'Delete', danger: true }).then((ok) => { if (ok) return actions.remove(app.id).then(actions.onClose); }) } }, 'Delete…')));

  const overlay = h('div', { className: 'drawer-overlay', on: { mousedown: (e) => { if (e.target === overlay) actions.onClose(); } } }, panel);
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.querySelector('.dialog-overlay')) actions.onClose();
  });
  queueMicrotask(() => closeBtn.focus());
  return overlay;
}
