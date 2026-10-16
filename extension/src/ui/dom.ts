// Tiny element builder. Everything the UI shows goes through textContent or
// attributes, never innerHTML, so extracted and model-provided strings cannot inject markup (R11.5).

export type Child = Node | string | number | null | undefined | false;

export interface Props {
  className?: string;
  /** `data-*` attributes. */
  dataset?: Record<string, string>;
  /** Event listeners, e.g. `{ click: handler }`. */
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
  /** Any other value becomes an attribute; `true` sets a bare attribute, `false`/null/undefined omits it. */
  [attr: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'className') el.className = String(value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'on') {
      for (const [name, handler] of Object.entries(value as Record<string, EventListener>)) {
        el.addEventListener(name, handler);
      }
    } else if (key === 'value' && 'value' in el) (el as unknown as HTMLInputElement).value = String(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

/** Replaces all children of `parent`. */
export function render(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, children);
}
