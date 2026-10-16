// Kanban board (R7). Rendering is a pure function of the stored applications; all
// changes go through the service worker and come back via storage.onChanged.
import { KANBAN_COLUMNS, STATUSES, STATUS_LABELS } from '../shared/constants';
import type { Application, Status } from '../shared/types';
import { daysSince } from '../domain/metrics';
import { confirmDialog, openDialog } from '../ui/dialog';
import { h, render } from '../ui/dom';
import { formatDaysAgo } from '../ui/format';

export type ColumnId = (typeof KANBAN_COLUMNS)[number]['id'];

export interface KanbanColumn {
  id: ColumnId;
  label: string;
  apps: Application[];
}

/** Applications grouped into the five columns, most recently updated first (R7.1–R7.2). */
export function groupByColumn(apps: readonly Application[]): KanbanColumn[] {
  return KANBAN_COLUMNS.map((col) => ({
    id: col.id,
    label: col.label,
    apps: apps
      .filter((a) => (col.statuses as readonly Status[]).includes(a.status))
      .sort((a, b) => b.lastUpdateAt - a.lastUpdateAt || a.company.localeCompare(b.company)),
  }));
}

export interface KanbanActions {
  setStatus(applicationId: string, status: Status): Promise<void>;
  edit(applicationId: string, fields: { company: string; role: string }): Promise<void>;
  remove(applicationId: string): Promise<void>;
}

export interface KanbanOptions {
  /** Wall clock for "days since applied"; injectable for tests. */
  now?: () => number;
}

export const DRAG_TYPE = 'application/x-job-tracker-id';

/** Which status a card dropped on `column` gets; Closed asks rejected vs withdrawn. */
async function statusForColumn(column: ColumnId): Promise<Status | undefined> {
  if (column !== 'closed') return KANBAN_COLUMNS.find((c) => c.id === column)?.statuses[0];
  return openDialog<Status>({
    title: 'Close this application as…',
    content: h('p', null, 'Choose how this application ended.'),
    actions: [
      { label: 'Cancel', value: undefined as unknown as Status },
      { label: STATUS_LABELS.withdrawn, value: 'withdrawn' },
      { label: STATUS_LABELS.rejected, value: 'rejected', kind: 'primary' },
    ],
  });
}

export async function editDialog(app: Application): Promise<{ company: string; role: string } | undefined> {
  const company = h('input', { id: 'edit-company', type: 'text', value: app.company, autocomplete: 'off' });
  const role = h('input', { id: 'edit-role', type: 'text', value: app.role, autocomplete: 'off' });
  const saved = await openDialog<boolean>({
    title: 'Edit application',
    content: h('div', null,
      h('div', { className: 'field' }, h('label', { for: 'edit-company' }, 'Company'), company),
      h('div', { className: 'field' }, h('label', { for: 'edit-role' }, 'Role'), role)),
    actions: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, kind: 'primary' }],
  });
  if (!saved || !company.value.trim() || !role.value.trim()) return undefined;
  return { company: company.value.trim(), role: role.value.trim() };
}

export function renderKanban(
  container: Element,
  apps: readonly Application[],
  actions: KanbanActions,
  options: KanbanOptions = {},
): void {
  const now = (options.now ?? Date.now)();

  if (apps.length === 0) {
    render(container, h('div', { className: 'empty' },
      h('p', null, h('strong', null, 'No applications yet')),
      h('p', { className: 'small' }, 'Open an application email in Gmail and click “Analyze this email”. It will appear here.')));
    return;
  }

  let openMenu: HTMLElement | null = null;
  const closeMenu = (): void => {
    openMenu?.remove();
    openMenu = null;
  };

  async function move(app: Application, status: Status): Promise<void> {
    closeMenu();
    if (status !== app.status) await actions.setStatus(app.id, status);
  }

  function menuFor(app: Application, anchor: HTMLElement): void {
    closeMenu();
    const item = (label: string, onClick: () => void, extra: Record<string, unknown> = {}) =>
      h('button', { type: 'button', role: 'menuitem', on: { click: onClick }, ...extra }, label);

    const menu = h('div', { className: 'menu', role: 'menu', 'aria-label': `Actions for ${app.company}` },
      h('span', { className: 'menu-label' }, 'Move to…'),
      ...STATUSES.map((s) => item(STATUS_LABELS[s], () => void move(app, s), { 'aria-current': s === app.status ? 'true' : undefined })),
      h('hr'),
      item('Edit…', () => {
        closeMenu();
        void editDialog(app).then((fields) => fields && actions.edit(app.id, fields));
      }),
      item('Delete…', () => {
        closeMenu();
        void confirmDialog({
          title: 'Delete application?',
          message: `${app.company} — ${app.role} and its alerts will be removed. You can add it again by analyzing its emails.`,
          confirmLabel: 'Delete',
          danger: true,
        }).then((ok) => { if (ok) return actions.remove(app.id); });
      }),
    );
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeMenu();
        anchor.focus();
      }
    });
    anchor.parentElement?.appendChild(menu);
    openMenu = menu;
    (menu.querySelector('button') as HTMLElement | null)?.focus();
  }

  function card(app: Application): HTMLElement {
    const days = daysSince(app.appliedAt, now);
    const menuBtn = h('button', {
      type: 'button',
      className: 'btn btn-icon kcard-menu-btn',
      'aria-label': `Actions for ${app.company} — ${app.role}`,
      'aria-haspopup': 'menu',
      on: { click: (e) => { e.stopPropagation(); menuFor(app, menuBtn); } },
    }, '⋯');
    const el = h('div', {
      className: 'kcard',
      draggable: 'true',
      dataset: { id: app.id },
      on: {
        dragstart: (e) => {
          e.dataTransfer?.setData(DRAG_TYPE, app.id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
          el.dataset.dragging = 'true';
        },
        dragend: () => delete el.dataset.dragging,
      },
    },
      h('div', { className: 'kcard-company' }, app.company),
      h('div', { className: 'kcard-role' }, app.role),
      h('div', { className: 'kcard-meta' },
        h('span', null, `${app.appliedAtEstimated ? '~' : ''}${formatDaysAgo(days)}`),
        app.status === 'rejected' || app.status === 'withdrawn'
          ? h('span', { className: 'chip', dataset: { status: app.status } }, STATUS_LABELS[app.status])
          : null),
      menuBtn);
    return el;
  }

  const columns = groupByColumn(apps).map((col) => {
    const body = h('div', { className: 'column-body' }, ...col.apps.map(card));
    return h('div', {
      className: 'column',
      role: 'group',
      'aria-label': `${col.label}, ${col.apps.length} application${col.apps.length === 1 ? '' : 's'}`,
      dataset: { column: col.id },
      on: {
        dragover: (e) => {
          if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).dataset.dropTarget = 'true';
        },
        dragleave: (e) => delete (e.currentTarget as HTMLElement).dataset.dropTarget,
        drop: (e) => {
          const column = e.currentTarget as HTMLElement;
          delete column.dataset.dropTarget;
          if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return; // not one of our cards
          const id = e.dataTransfer?.getData(DRAG_TYPE);
          const app = apps.find((a) => a.id === id);
          if (!app) return;
          e.preventDefault();
          void statusForColumn(col.id).then((status) => status && move(app, status));
        },
      },
    }, h('div', { className: 'column-title' }, h('span', null, col.label), h('span', { className: 'muted' }, String(col.apps.length))), body);
  });

  render(container, h('div', { className: 'board' }, ...columns));
  container.addEventListener('click', closeMenu, { once: true });
}
