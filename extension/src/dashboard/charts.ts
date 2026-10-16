// Hand-written SVG charts (R8.3, R8.11): no libraries, no remote assets. Every chart has
// a text title/description for screen readers, tooltips via <title>, and visible text labels.
import { STATUS_LABELS } from '../shared/constants';
import type { FunnelStep, WeekBucket } from '../domain/metrics';
import { render } from '../ui/dom';

const NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const weekLabel = (t: number): string => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

let counter = 0;

function chartFrame(title: string, description: string, viewBox: string, ...content: SVGElement[]): SVGSVGElement {
  const id = `chart${++counter}`;
  return svg('svg', { viewBox, role: 'img', 'aria-labelledby': `${id}-t ${id}-d` },
    svg('title', { id: `${id}-t` }, title), svg('desc', { id: `${id}-d` }, description), ...content);
}

export function renderWeeklyChart(container: Element, weeks: readonly WeekBucket[]): void {
  const W = 360, H = 170, left = 26, right = 6, top = 18, bottom = 26;
  const plotW = W - left - right, plotH = H - top - bottom;
  const max = Math.max(1, ...weeks.map((w) => w.count));
  const slot = plotW / Math.max(1, weeks.length);
  const barW = slot * 0.72;

  const total = weeks.reduce((n, w) => n + w.count, 0);
  const description = `${plural(total, 'application')} in the last ${weeks.length} weeks. ` +
    weeks.map((w) => `Week of ${weekLabel(w.weekStart)}: ${w.count}`).join('; ') + '.';

  const parts: SVGElement[] = [
    svg('line', { class: 'axis', x1: left, y1: top + plotH, x2: W - right, y2: top + plotH }),
    svg('text', { x: left - 4, y: top + 4, 'text-anchor': 'end' }, String(max)),
    svg('text', { x: left - 4, y: top + plotH, 'text-anchor': 'end' }, '0'),
  ];
  weeks.forEach((w, i) => {
    const bh = (w.count / max) * plotH;
    const x = left + i * slot + (slot - barW) / 2;
    parts.push(svg('rect', { class: 'bar', x, y: top + plotH - bh, width: barW, height: Math.max(bh, w.count > 0 ? 1 : 0) },
      svg('title', {}, `Week of ${weekLabel(w.weekStart)}: ${plural(w.count, 'application')}`)));
    if (w.count > 0) parts.push(svg('text', { x: x + barW / 2, y: top + plotH - bh - 3, 'text-anchor': 'middle' }, String(w.count)));
    if ((weeks.length - 1 - i) % 3 === 0) {
      parts.push(svg('text', { x: x + barW / 2, y: H - 8, 'text-anchor': 'middle' }, weekLabel(w.weekStart)));
    }
  });

  const heading = document.createElement('h2');
  heading.textContent = 'Applications per week';
  render(container, heading, chartFrame('Applications per week', description, `0 0 ${W} ${H}`, ...parts));
}

const FUNNEL_LABELS: Record<FunnelStep['stage'], string> = {
  applied: STATUS_LABELS.applied,
  screening: STATUS_LABELS.screening,
  interview_scheduled: STATUS_LABELS.interview_scheduled,
  offer: STATUS_LABELS.offer,
};

export function renderFunnel(container: Element, steps: readonly FunnelStep[]): void {
  const W = 360, rowH = 34, H = steps.length * rowH + 8, labelW = 130, barMax = W - labelW - 44;
  const total = Math.max(1, steps[0]?.count ?? 0);
  const description = 'How many applications reached each stage: ' +
    steps.map((s) => `${FUNNEL_LABELS[s.stage]} ${s.count}`).join('; ') + '.';

  const parts: SVGElement[] = [];
  steps.forEach((s, i) => {
    const y = 4 + i * rowH;
    const w = s.count === 0 ? 0 : Math.max(3, (s.count / total) * barMax);
    parts.push(
      svg('text', { x: labelW - 8, y: y + 19, 'text-anchor': 'end' }, FUNNEL_LABELS[s.stage]),
      svg('rect', { class: 'bar', x: labelW, y, width: w, height: rowH - 10 },
        svg('title', {}, `${FUNNEL_LABELS[s.stage]}: ${plural(s.count, 'application')}`)),
      svg('text', { x: labelW + w + 6, y: y + 19 }, String(s.count)),
    );
  });

  const heading = document.createElement('h2');
  heading.textContent = 'Status funnel';
  render(container, heading, chartFrame('Status funnel', description, `0 0 ${W} ${H}`, ...parts));
}
