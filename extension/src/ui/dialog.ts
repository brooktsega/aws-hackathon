// Minimal accessible modal (role=dialog, focus trap, Escape/backdrop to cancel).
// Built by hand because <dialog>.showModal() support varies across test and browser environments.
import { h } from './dom';

export interface DialogAction<T> {
  label: string;
  value: T;
  kind?: 'primary' | 'danger' | 'default';
}

let counter = 0;
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Shows a modal and resolves with the clicked action's value, or undefined if dismissed. */
export function openDialog<T>(options: {
  title: string;
  content: Node;
  actions: DialogAction<T>[];
}): Promise<T | undefined> {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const titleId = `dialog-title-${++counter}`;

    const finish = (value: T | undefined): void => {
      document.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      previouslyFocused?.focus?.();
      resolve(value);
    };

    const buttons = options.actions.map((a) =>
      h('button', { type: 'button', className: `btn btn-${a.kind ?? 'default'}`, on: { click: () => finish(a.value) } }, a.label),
    );
    const panel = h(
      'div',
      { className: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('h2', { id: titleId, className: 'dialog-title' }, options.title),
      h('div', { className: 'dialog-body' }, options.content),
      h('div', { className: 'dialog-actions' }, ...buttons),
    );
    const overlay = h('div', { className: 'dialog-overlay', on: { mousedown: (e) => e.target === overlay && finish(undefined) } }, panel);

    function onKeydown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation();
        finish(undefined);
      } else if (event.key === 'Tab') {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('disabled'));
        if (items.length === 0) return;
        const first = items[0] as HTMLElement;
        const last = items[items.length - 1] as HTMLElement;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', onKeydown, true);
    document.body.appendChild(overlay);
    (panel.querySelector<HTMLElement>('input, select, textarea') ?? buttons[buttons.length - 1])?.focus();
  });
}

export async function confirmDialog(options: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  const result = await openDialog<boolean>({
    title: options.title,
    content: h('p', null, options.message),
    actions: [
      { label: 'Cancel', value: false },
      { label: options.confirmLabel, value: true, kind: options.danger ? 'danger' : 'primary' },
    ],
  });
  return result === true;
}
