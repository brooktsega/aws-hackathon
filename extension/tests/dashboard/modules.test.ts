// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAlertsPanel } from '../../src/dashboard/alerts-panel';
import { renderFunnel, renderWeeklyChart } from '../../src/dashboard/charts';
import { CSV_BOM, csvCell, csvFilename, downloadCsv, toCsv } from '../../src/dashboard/csv';
import { gmailThreadUrl } from '../../src/dashboard/drawer';
import { createDrawer } from '../../src/dashboard/drawer';
import { parseDateInput, toFilters } from '../../src/dashboard/filters';
import { DEFAULT_SORT, nextSort, renderTable, sortApplications } from '../../src/dashboard/table';
import type { Sort, SortKey } from '../../src/dashboard/table';
import { renderTiles } from '../../src/dashboard/tiles';
import { computeMetrics, funnel, weeklyApplications } from '../../src/domain/metrics';
import type { Alert } from '../../src/shared/types';
import { DAY, T0, entry, makeApp } from '../helpers';

const NOW = T0 + 10 * DAY;
const flush = () => new Promise((r) => setTimeout(r, 0));

const acme = makeApp('a', 'Acme', 'Software Engineer', [entry('applied', T0)]);
const globex = makeApp('g', 'globex', 'Data Analyst', [entry('applied', T0 + 2 * DAY), entry('screening', T0 + 6 * DAY)]);
const initech = makeApp('i', 'Initech', 'Product Manager', [entry('applied', T0 + DAY), entry('rejected', T0 + 8 * DAY)]);
const hooli = makeApp('h', 'Hooli', 'SRE', [entry('rejected', T0 + 3 * DAY)]); // estimated applied date
const apps = [acme, globex, initech, hooli];

let host: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
});

describe('sortApplications (R8.5)', () => {
  const order = (key: SortKey, dir: 'asc' | 'desc') => sortApplications(apps, { key, dir }).map((a) => a.id);

  it('sorts text case-insensitively', () => {
    expect(order('company', 'asc')).toEqual(['a', 'g', 'h', 'i']); // Acme, globex, Hooli, Initech
    expect(order('company', 'desc')).toEqual(['i', 'h', 'g', 'a']);
    expect(order('role', 'asc')).toEqual(['g', 'i', 'a', 'h']);
  });

  it('sorts dates numerically, not as strings', () => {
    expect(order('appliedAt', 'asc')).toEqual(['a', 'i', 'g', 'h']); // T0, +1d, +2d, +3d
    expect(order('lastUpdateAt', 'desc')).toEqual(['i', 'g', 'h', 'a']); // +8d, +6d, +3d, T0
  });

  it('sorts days-since-applied by how long ago, oldest application = most days', () => {
    expect(order('daysSince', 'desc')).toEqual(['a', 'i', 'g', 'h']);
    expect(order('daysSince', 'asc')).toEqual(['h', 'g', 'i', 'a']);
  });

  it('sorts by status in pipeline order', () => {
    expect(order('status', 'asc')).toEqual(['a', 'g', 'h', 'i']); // ties (both rejected) fall back to company name
    const statuses = sortApplications(apps, { key: 'status', dir: 'asc' }).map((a) => a.status);
    expect(statuses).toEqual(['applied', 'screening', 'rejected', 'rejected']);
  });

  it('always puts missing rejection dates last, in either direction', () => {
    expect(order('rejectedAt', 'asc').slice(0, 2)).toEqual(['h', 'i']);
    expect(order('rejectedAt', 'desc').slice(0, 2)).toEqual(['i', 'h']);
    expect(order('rejectedAt', 'asc').slice(2).sort()).toEqual(['a', 'g']);
    expect(order('rejectedAt', 'desc').slice(2).sort()).toEqual(['a', 'g']);
  });

  it('does not mutate its input', () => {
    const copy = [...apps];
    sortApplications(apps, { key: 'company', dir: 'desc' });
    expect(apps).toEqual(copy);
  });
});

describe('nextSort', () => {
  it('toggles direction on the same column and starts ascending on a new one', () => {
    expect(nextSort({ key: 'company', dir: 'asc' }, 'company')).toEqual({ key: 'company', dir: 'desc' });
    expect(nextSort({ key: 'company', dir: 'desc' }, 'company')).toEqual({ key: 'company', dir: 'asc' });
    expect(nextSort({ key: 'company', dir: 'desc' }, 'role')).toEqual({ key: 'role', dir: 'asc' });
  });
});

describe('renderTable (R8.4, R8.5, R8.7, R8.10)', () => {
  const render = (list = apps, sort: Sort = DEFAULT_SORT, handlers: { onSort?: (k: SortKey) => void; onOpen?: (id: string) => void } = {}) =>
    renderTable(host, list, { now: NOW, sort, onSort: handlers.onSort ?? vi.fn(), onOpen: handlers.onOpen ?? vi.fn() });

  it('has the required columns', () => {
    render();
    expect(Array.from(host.querySelectorAll('th')).map((t) => t.textContent!.replace(/[▲▼]/g, ''))).toEqual([
      'Company', 'Role', 'Status', 'Applied', 'Days since applied', 'Last update', 'Rejected',
    ]);
  });

  it('shows row values: status label, days since applied, rejected date or a dash', () => {
    render([acme, initech]);
    const row = (id: string) => host.querySelector(`tr[data-id="${id}"]`) as HTMLElement;
    expect(row('a').textContent).toContain('Acme');
    expect(row('a').textContent).toContain('Software Engineer');
    expect(row('a').querySelector('.chip')!.textContent).toBe('Applied');
    expect(row('a').children[4]!.textContent).toBe('10');
    expect(row('a').children[6]!.textContent).toBe('—');
    expect(row('i').children[6]!.textContent).not.toBe('—');
    expect(row('i').querySelector('.chip')!.textContent).toBe('Rejected');
  });

  it('marks estimated applied dates (R8.10)', () => {
    render([hooli, acme]);
    expect(host.querySelector('tr[data-id="h"]')!.textContent).toContain('(est.)');
    expect(host.querySelector('tr[data-id="a"]')!.textContent).not.toContain('(est.)');
  });

  it('marks the sorted column with aria-sort and an arrow', () => {
    render(apps, { key: 'company', dir: 'desc' });
    const ths = Array.from(host.querySelectorAll('th'));
    expect(ths[0]!.getAttribute('aria-sort')).toBe('descending');
    expect(ths[0]!.textContent).toContain('▼');
    expect(ths[1]!.getAttribute('aria-sort')).toBe('none');
  });

  it('sorts when a header is clicked', () => {
    const onSort = vi.fn();
    render(apps, DEFAULT_SORT, { onSort });
    (host.querySelectorAll('th button')[3] as HTMLButtonElement).click();
    expect(onSort).toHaveBeenCalledWith('appliedAt');
  });

  it('opens a row by clicking the row or its company button, once', () => {
    const onOpen = vi.fn();
    render([acme], DEFAULT_SORT, { onOpen });
    (host.querySelector('tr[data-id="a"]') as HTMLElement).click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    (host.querySelector('tr[data-id="a"] button') as HTMLButtonElement).click();
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenLastCalledWith('a');
  });

  it('says so when nothing matches', () => {
    render([]);
    expect(host.textContent).toContain('No applications match these filters.');
  });

  it('renders untrusted text as text (R11.5)', () => {
    render([makeApp('x', '<img src=x onerror=alert(1)>', '<b>r</b>', [entry('applied', T0)])]);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('b')).toBeNull();
  });
});

describe('renderTiles (R8.2, R8.10)', () => {
  it('shows the six metrics', () => {
    renderTiles(host, computeMetrics(apps));
    const tiles = Array.from(host.querySelectorAll('.tile')).map((t) => [t.querySelector('.tile-label')!.textContent, t.querySelector('.tile-value')!.textContent]);
    expect(tiles).toEqual([
      ['Applications', '4'],
      ['Active', '2'],
      ['Response rate', '75%'],
      ['Days to first response', '5.5'], // 4 and 7 days; Hooli's estimated date is ignored
      ['Days to rejection', '7'],
      ['Rejections', '2'],
    ]);
  });

  it('shows dashes and 0% with no data, and notes estimated dates', () => {
    renderTiles(host, computeMetrics([]));
    expect(host.textContent).toContain('0%');
    expect(host.querySelectorAll('.tile-value')[3]!.textContent).toBe('—');
    renderTiles(host, computeMetrics([hooli]));
    expect(host.textContent).toContain('Includes 2 estimated dates');
  });
});

describe('charts (R8.3, R8.11)', () => {
  it('draws one bar per week with an accessible description', () => {
    renderWeeklyChart(host, weeklyApplications(apps, NOW));
    expect(host.querySelectorAll('svg rect.bar')).toHaveLength(12);
    const svg = host.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(host.querySelector('desc')!.textContent).toContain('4 applications in the last 12 weeks');
    expect(host.querySelector('rect.bar title')!.textContent).toMatch(/Week of .*: \d+ applications?/);
    expect(host.querySelector('h2')!.textContent).toBe('Applications per week');
  });

  it('scales bars to the busiest week and handles an empty set', () => {
    renderWeeklyChart(host, weeklyApplications([], NOW));
    expect(Array.from(host.querySelectorAll('rect.bar')).every((r) => r.getAttribute('height') === '0')).toBe(true);
    renderWeeklyChart(host, weeklyApplications([acme, makeApp('b', 'B', 'X', [entry('applied', T0)])], NOW));
    const heights = Array.from(host.querySelectorAll('rect.bar')).map((r) => Number(r.getAttribute('height')));
    expect(Math.max(...heights)).toBeGreaterThan(0);
  });

  it('draws the funnel with a label and count for each stage', () => {
    renderFunnel(host, funnel(apps));
    const text = host.querySelector('svg')!.textContent!;
    for (const label of ['Applied', 'Screening', 'Interview Scheduled', 'Offer']) expect(text).toContain(label);
    expect(host.querySelectorAll('rect.bar')).toHaveLength(4);
    expect(host.querySelector('desc')!.textContent).toContain('Applied 4');
  });

  it('loads nothing remote and uses no scripts', () => {
    renderWeeklyChart(host, weeklyApplications(apps, NOW));
    renderFunnel(host, funnel(apps));
    expect(host.querySelector('script, image, use, foreignObject, [href], [src]')).toBeNull();
  });
});

describe('csv (R8.9)', () => {
  it('quotes commas, quotes, and newlines', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it.each(['=SUM(A1)', '+1', '-2', '@cmd', '\tx'])('defuses spreadsheet formulas: %j', (value) => {
    expect(csvCell(value).replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('writes a header and one ISO-dated row per application', () => {
    const csv = toCsv([initech, acme], NOW);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('Company,Role,Status,Applied,Applied date estimated,Days since applied,First response,Last update,Rejected');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(`Initech,Product Manager,rejected,${new Date(T0 + DAY).toISOString()},no,9,${new Date(T0 + 8 * DAY).toISOString()},${new Date(T0 + 8 * DAY).toISOString()},${new Date(T0 + 8 * DAY).toISOString()}`);
    expect(lines[2]).toBe(`Acme,Software Engineer,applied,${new Date(T0).toISOString()},no,10,,${new Date(T0).toISOString()},`);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('keeps awkward company names intact', () => {
    const csv = toCsv([makeApp('x', 'Smith, Jones & "Co"', '=HYPERLINK("x")', [entry('applied', T0)])], NOW);
    expect(csv).toContain('"Smith, Jones & ""Co"""');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('names the file by date', () => {
    expect(csvFilename(Date.UTC(2026, 9, 16, 12))).toBe('job-applications-2026-10-16.csv');
  });

  it('downloads through a temporary link with a BOM and then cleans up', async () => {
    let blob: Blob | undefined;
    const create = vi.fn((b: Blob) => ((blob = b), 'blob:test'));
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('x.csv');
      expect(this.href).toBe('blob:test');
    });
    downloadCsv('a,b\r\n', 'x.csv');
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]')).toBeNull();
    // Blob.text() strips a leading BOM, so inspect the raw bytes.
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe(`${CSV_BOM}a,b\r\n`);
    click.mockRestore();
    await new Promise((r) => setTimeout(r, 1100));
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });
});

describe('filters', () => {
  it('parses date inputs as local days, inclusive at the end', () => {
    expect(parseDateInput('2026-10-01', false)).toBe(new Date(2026, 9, 1, 0, 0, 0, 0).getTime());
    expect(parseDateInput('2026-10-01', true)).toBe(new Date(2026, 9, 1, 23, 59, 59, 999).getTime());
  });

  it.each(['', 'nope', '2026-13-01', '2026-02-31', '10/01/2026'])('rejects %j', (value) => {
    expect(parseDateInput(value, false)).toBeUndefined();
  });

  it('builds domain filters, skipping empty controls', () => {
    expect(toFilters({ status: '', from: '', to: '', text: '  ' })).toEqual({});
    expect(toFilters({ status: 'rejected', from: '2026-10-01', to: '2026-10-31', text: 'acme' })).toEqual({
      statuses: ['rejected'],
      from: new Date(2026, 9, 1).getTime(),
      to: new Date(2026, 9, 31, 23, 59, 59, 999).getTime(),
      text: 'acme',
    });
  });
});

describe('alerts panel (R9.4, R9.6, R9.7)', () => {
  const alert = (id: string, extra: Partial<Alert> = {}): Alert => ({
    id, type: 'upcoming_event', company: 'Acme', companyKey: 'acme', firmKnown: true, title: 'Interview', startsAt: NOW + DAY,
    source: { threadId: 't', subject: 's', messageKey: 'k' }, state: 'active', createdAt: NOW, ...extra,
  });

  it('lists active alerts with dismiss and past alerts without it', () => {
    const onDismiss = vi.fn();
    renderAlertsPanel(host, [alert('a'), alert('p', { state: 'past', title: 'Old call', startsAt: NOW - DAY }), alert('d', { state: 'dismissed' })], { now: NOW, onDismiss });
    expect(host.querySelectorAll('li')).toHaveLength(2);
    expect(host.querySelector('details summary')!.textContent).toBe('Past (1)');
    const buttons = host.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    buttons[0]!.click();
    expect(onDismiss).toHaveBeenCalledWith('a');
    expect(host.textContent).not.toContain('Dismiss: ' + 'd');
  });

  it('shows an empty state', () => {
    renderAlertsPanel(host, [], { now: NOW, onDismiss: vi.fn() });
    expect(host.textContent).toContain('No upcoming events');
    expect(host.querySelector('details')).toBeNull();
  });

  it('tags opportunities from firms you applied to', () => {
    const opp = alert('o', { type: 'new_opportunity', title: 'PM' });
    delete (opp as { startsAt?: number }).startsAt;
    renderAlertsPanel(host, [opp], { now: NOW, onDismiss: vi.fn() });
    expect(host.textContent).toContain('Firm you’ve applied to');
  });
});

describe('drawer (R8.7, R8.8, R7.5)', () => {
  const withThreads = makeApp('t', 'Acme', 'SWE', [
    entry('applied', T0, { threadId: 'FMfcgzQbcdefghij', subject: 'Thanks for applying', evidence: 'We received your application' }),
    entry('screening', T0 + DAY, { threadId: 'bad id with spaces', subject: 'Next steps' }),
    { status: 'interview_scheduled', at: T0 + 2 * DAY, source: 'manual' as const },
  ]);
  const actions = () => ({
    setStatus: vi.fn(async () => undefined),
    edit: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    onClose: vi.fn(),
  });

  it('builds safe Gmail links only for well-formed thread ids', () => {
    expect(gmailThreadUrl('FMfcgzQbcdefghij')).toBe('https://mail.google.com/mail/u/0/#all/FMfcgzQbcdefghij');
    expect(gmailThreadUrl('bad id')).toBeNull();
    expect(gmailThreadUrl('"><script>')).toBeNull();
    expect(gmailThreadUrl(undefined)).toBeNull();
  });

  it('shows the timeline newest first with source emails and Gmail links in a new tab', () => {
    const el = createDrawer(withThreads, actions());
    host.append(el);
    const items = Array.from(el.querySelectorAll('.timeline li'));
    expect(items.map((li) => li.querySelector('.chip')!.textContent)).toEqual(['Interview Scheduled', 'Screening', 'Applied']);
    expect(items[0]!.textContent).toContain('Set manually');
    expect(items[2]!.textContent).toContain('We received your application');
    const links = el.querySelectorAll('a');
    expect(links).toHaveLength(1); // the malformed thread id gets no link
    expect(links[0]!.getAttribute('href')).toBe('https://mail.google.com/mail/u/0/#all/FMfcgzQbcdefghij');
    expect(links[0]!.getAttribute('target')).toBe('_blank');
    expect(links[0]!.getAttribute('rel')).toContain('noopener');
  });

  it('shows the key dates', () => {
    const el = createDrawer(initech, actions());
    expect(el.textContent).toContain('First response');
    expect(el.textContent).toContain('Rejected');
    expect(createDrawer(hooli, actions()).textContent).toContain('(estimated)');
  });

  it('sets the status manually, closes with the button, Escape, and the backdrop', () => {
    const a = actions();
    const el = createDrawer(acme, a);
    host.append(el);
    const select = el.querySelector('select') as HTMLSelectElement;
    select.value = 'offer';
    select.dispatchEvent(new Event('change'));
    expect(a.setStatus).toHaveBeenCalledWith('a', 'offer');

    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Close') as HTMLButtonElement).click();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(a.onClose).toHaveBeenCalledTimes(3);
  });

  it('deletes only after confirmation and then closes', async () => {
    const a = actions();
    const el = createDrawer(acme, a);
    host.append(el);
    const del = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Delete…') as HTMLButtonElement;
    del.click();
    (Array.from(document.querySelectorAll('.dialog button')).find((b) => b.textContent === 'Cancel') as HTMLButtonElement).click();
    await flush();
    expect(a.remove).not.toHaveBeenCalled();
    del.click();
    (Array.from(document.querySelectorAll('.dialog button')).find((b) => b.textContent === 'Delete') as HTMLButtonElement).click();
    await flush();
    expect(a.remove).toHaveBeenCalledWith('a');
    expect(a.onClose).toHaveBeenCalled();
  });

  it('edits company and role', async () => {
    const a = actions();
    const el = createDrawer(acme, a);
    host.append(el);
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Edit…') as HTMLButtonElement).click();
    (document.getElementById('edit-role') as HTMLInputElement).value = 'Staff Engineer';
    (Array.from(document.querySelectorAll('.dialog button')).find((b) => b.textContent === 'Save') as HTMLButtonElement).click();
    await flush();
    expect(a.edit).toHaveBeenCalledWith('a', { company: 'Acme', role: 'Staff Engineer' });
  });
});
