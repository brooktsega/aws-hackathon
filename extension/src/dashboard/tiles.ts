// Metric tiles (R8.2, R8.10).
import type { Metrics } from '../domain/metrics';
import { h, render } from '../ui/dom';
import { formatDays, formatPercent } from '../ui/format';

export function renderTiles(container: Element, m: Metrics): void {
  const tile = (label: string, value: string, note?: string) =>
    h('div', { className: 'tile', role: 'group', 'aria-label': label },
      h('div', { className: 'tile-label' }, label),
      h('div', { className: 'tile-value' }, value),
      note ? h('div', { className: 'tile-note' }, note) : null);

  const estimate = m.estimatedIncluded > 0 ? `Includes ${m.estimatedIncluded} estimated date${m.estimatedIncluded === 1 ? '' : 's'}` : undefined;
  render(container,
    tile('Applications', String(m.total)),
    tile('Active', String(m.active), 'Not rejected, withdrawn, or at offer'),
    tile('Response rate', formatPercent(m.responseRate), 'Heard back at all'),
    tile('Days to first response', formatDays(m.medianDaysToResponse), ['Median', estimate].filter(Boolean).join(' · ')),
    tile('Days to rejection', formatDays(m.medianDaysToRejection), ['Median', estimate].filter(Boolean).join(' · ')),
    tile('Rejections', String(m.rejections)));
}
