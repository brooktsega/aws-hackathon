// "Analyze this email" section: availability rules and the idle/loading/result/error flow (R3).
import type { send as sendFn } from '../shared/client';
import { ERROR_INFO } from '../shared/errors';
import type { AnalysisEdits, AnalysisPreview, AppError, Result, ViewState } from '../shared/types';
import { h, render } from '../ui/dom';
import { createResultCard } from './result-card';

export type Availability = { kind: 'ready' } | { kind: 'disabled'; reason: 'no_key' | 'not_thread' };

/** R3.1–R3.3: a missing key outranks the view, since Settings is the first thing to fix. */
export function computeAvailability(hasKey: boolean, view: ViewState | undefined): Availability {
  if (!hasKey) return { kind: 'disabled', reason: 'no_key' };
  if (!view?.isThreadView) return { kind: 'disabled', reason: 'not_thread' };
  return { kind: 'ready' };
}

export interface AnalyzeContext {
  hasKey: boolean;
  disclosureAccepted: boolean;
  view: ViewState | undefined;
}

export interface AnalyzeDeps {
  send: typeof sendFn;
  askDisclosure(): Promise<boolean>;
  openSettings(): void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'result'; preview: AnalysisPreview }
  | { kind: 'error'; error: AppError }
  | { kind: 'saved'; text: string };

export interface AnalyzeSection {
  element: HTMLElement;
  setContext(context: AnalyzeContext): void;
}

const errorText = (e: AppError): string => (e.code === 'INVALID_REQUEST' ? e.message : ERROR_INFO[e.code].message);

export function createAnalyzeSection({ send, askDisclosure, openSettings }: AnalyzeDeps): AnalyzeSection {
  const element = h('section', { className: 'section', 'aria-labelledby': 'analyze-title' });
  let context: AnalyzeContext = { hasKey: false, disclosureAccepted: false, view: undefined };
  let state: State = { kind: 'idle' };
  // Keep the result card (and the user's edits in it) alive across redraws caused by context changes.
  let card: { preview: AnalysisPreview; el: HTMLElement } | null = null;

  const set = (next: State): void => {
    state = next;
    if (next.kind !== 'result') card = null;
    draw();
  };

  async function analyze(): Promise<void> {
    if (state.kind === 'loading') return; // R12.5 (the worker also enforces this)
    if (!context.disclosureAccepted) {
      if (!(await askDisclosure())) return;
      const saved = await send({ type: 'SAVE_SETTINGS', payload: { disclosureAccepted: true } });
      if (!saved.ok) return set({ kind: 'error', error: saved.error });
      context = { ...context, disclosureAccepted: true };
    }
    set({ kind: 'loading' });
    const r = await send({ type: 'ANALYZE_ACTIVE_EMAIL' });
    set(r.ok ? { kind: 'result', preview: r.data } : { kind: 'error', error: r.error });
  }

  async function save(preview: AnalysisPreview, edits: AnalysisEdits): Promise<Result<unknown>> {
    const r = await send({ type: 'SAVE_ANALYSIS', payload: { preview, edits } });
    if (r.ok) {
      const label = edits.status ? `${edits.company}${edits.role ? ` — ${edits.role}` : ''}` : 'alerts';
      set({ kind: 'saved', text: `Saved ${label}.` });
    }
    return r;
  }

  function draw(): void {
    const availability = computeAvailability(context.hasKey, context.view);
    const busy = state.kind === 'loading';
    const button = h(
      'button',
      { type: 'button', className: 'btn btn-primary', disabled: availability.kind !== 'ready' || busy || state.kind === 'result', on: { click: () => void analyze() } },
      busy ? 'Analyzing…' : 'Analyze this email',
    );

    const body: (HTMLElement | null)[] = [];
    if (availability.kind === 'disabled') {
      body.push(
        availability.reason === 'no_key'
          ? h('div', { className: 'notice' }, h('p', null, 'Add your Anthropic API key to analyze emails.'), h('button', { type: 'button', className: 'btn', on: { click: openSettings } }, 'Open Settings'))
          : h('p', { className: 'muted' }, 'Open an email in Gmail to analyze it.'),
      );
    }
    if (state.kind === 'loading') body.push(h('p', { role: 'status', 'aria-live': 'polite' }, 'Reading the email and asking Claude…'));
    if (state.kind === 'saved') body.push(h('p', { className: 'notice', role: 'status' }, state.text));
    if (state.kind === 'error') {
      const info = ERROR_INFO[state.error.code];
      body.push(
        h(
          'div',
          { className: 'notice notice-error', role: 'alert' },
          h('p', null, h('strong', null, 'Couldn’t analyze: '), errorText(state.error)),
          info.action === 'open_settings' ? h('button', { type: 'button', className: 'btn', on: { click: openSettings } }, 'Open Settings') : null,
          info.action === 'retry' ? h('button', { type: 'button', className: 'btn', on: { click: () => void analyze() } }, 'Try again') : null,
        ),
      );
    }
    if (state.kind === 'result') {
      const preview = state.preview;
      if (card?.preview !== preview) {
        card = { preview, el: createResultCard(preview, { onSave: (edits) => save(preview, edits), onDiscard: () => set({ kind: 'idle' }) }) };
      }
      body.push(card.el);
    }

    render(element, h('div', { className: 'section-title' }, h('h2', { id: 'analyze-title' }, 'Analyze email'), button), ...body);
  }

  draw();
  return {
    element,
    setContext(next) {
      context = next;
      draw();
    },
  };
}
