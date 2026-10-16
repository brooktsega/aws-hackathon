// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAG_TYPE, groupByColumn, renderKanban } from '../../src/sidepanel/kanban';
import type { KanbanActions } from '../../src/sidepanel/kanban';
import { DAY, T0, entry, makeApp } from '../helpers';

const NOW = T0 + 10 * DAY;
const flush = () => new Promise((r) => setTimeout(r, 0));

const acme = makeApp('a', 'Acme', 'Software Engineer', [entry('applied', T0)]);
const globex = makeApp('g', 'Globex', 'Data Analyst', [entry('applied', T0 + DAY), entry('screening', T0 + 4 * DAY)]);
const initech = makeApp('i', 'Initech', 'PM', [entry('applied', T0 + 2 * DAY), entry('rejected', T0 + 6 * DAY)]);
const hooli = makeApp('h', 'Hooli', 'SRE', [entry('applied', T0 + 3 * DAY), entry('withdrawn', T0 + 5 * DAY)]);
const estimated = makeApp('e', 'Pied Piper', 'CTO', [entry('interview_scheduled', T0 + 7 * DAY)]);

function actions(): KanbanActions & { [K in keyof KanbanActions]: ReturnType<typeof vi.fn> } {
  return { setStatus: vi.fn(async () => undefined), edit: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) } as never;
}

let host: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
});

const column = (id: string) => host.querySelector(`[data-column="${id}"]`) as HTMLElement;
const cardIn = (id: string) => host.querySelector(`[data-id="${id}"]`) as HTMLElement;
const menuItem = (label: string) => Array.from(document.querySelectorAll('[role="menuitem"]')).find((b) => b.textContent === label) as HTMLButtonElement;
const dialogButton = (label: string) => Array.from(document.querySelectorAll('.dialog button')).find((b) => b.textContent === label) as HTMLButtonElement;
const drop = (target: HTMLElement, id: string) => {
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { types: [DRAG_TYPE], getData: () => id, setData: () => undefined } });
  target.dispatchEvent(ev);
};

describe('groupByColumn (R7.1–R7.2)', () => {
  it('uses the five columns in order and puts rejected and withdrawn in Closed', () => {
    const cols = groupByColumn([acme, globex, initech, hooli, estimated]);
    expect(cols.map((c) => c.id)).toEqual(['applied', 'screening', 'interview_scheduled', 'offer', 'closed']);
    expect(cols.map((c) => c.apps.map((a) => a.id))).toEqual([['a'], ['g'], ['e'], [], ['i', 'h']]);
  });

  it('orders each column by most recent update', () => {
    const older = makeApp('o', 'Older', 'X', [entry('applied', T0)]);
    const newer = makeApp('n', 'Newer', 'X', [entry('applied', T0 + 5 * DAY)]);
    expect(groupByColumn([older, newer])[0]!.apps.map((a) => a.id)).toEqual(['n', 'o']);
  });
});

describe('renderKanban: rendering (R7.1–R7.3, R7.6)', () => {
  it('shows an empty state that explains how to add the first application', () => {
    renderKanban(host, [], actions(), { now: () => NOW });
    expect(host.textContent).toContain('No applications yet');
    expect(host.textContent).toContain('Analyze this email');
    expect(host.querySelector('.board')).toBeNull();
  });

  it('shows company, role, and days since applied on each card', () => {
    renderKanban(host, [acme, globex], actions(), { now: () => NOW });
    expect(cardIn('a').textContent).toContain('Acme');
    expect(cardIn('a').textContent).toContain('Software Engineer');
    expect(cardIn('a').textContent).toContain('10 days ago');
    expect(cardIn('g').textContent).toContain('9 days ago');
  });

  it('marks estimated applied dates with a tilde', () => {
    renderKanban(host, [estimated], actions(), { now: () => NOW });
    expect(cardIn('e').textContent).toContain('~3 days ago');
  });

  it('labels Closed cards with their specific status (R7.2)', () => {
    renderKanban(host, [initech, hooli, acme], actions(), { now: () => NOW });
    expect(cardIn('i').querySelector('.chip')!.textContent).toBe('Rejected');
    expect(cardIn('h').querySelector('.chip')!.textContent).toBe('Withdrawn');
    expect(cardIn('a').querySelector('.chip')).toBeNull();
  });

  it('shows counts and accessible column names', () => {
    renderKanban(host, [acme, initech, hooli], actions(), { now: () => NOW });
    expect(column('closed').getAttribute('aria-label')).toBe('Closed, 2 applications');
    expect(column('applied').getAttribute('aria-label')).toBe('Applied, 1 application');
    expect(column('offer').getAttribute('aria-label')).toBe('Offer, 0 applications');
  });

  it('renders company names as text, never markup (R11.5)', () => {
    const evil = makeApp('x', '<img src=x onerror=alert(1)>', '<b>role</b>', [entry('applied', T0)]);
    renderKanban(host, [evil], actions(), { now: () => NOW });
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('b')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('renders 500 applications quickly (R13.1)', () => {
    const many = Array.from({ length: 500 }, (_, i) => makeApp(`m${i}`, `Company ${i}`, 'Engineer', [entry('applied', T0 + i * 1000)]));
    const start = performance.now();
    renderKanban(host, many, actions(), { now: () => NOW });
    expect(performance.now() - start).toBeLessThan(300);
    expect(host.querySelectorAll('.kcard')).toHaveLength(500);
  });
});

describe('renderKanban: card menu (R7.4–R7.5, R7.7)', () => {
  const open = (id: string) => (cardIn(id).querySelector('.kcard-menu-btn') as HTMLButtonElement).click();

  it('moves a card with the “Move to…” menu, without drag and drop', async () => {
    const a = actions();
    renderKanban(host, [acme], a, { now: () => NOW });
    open('a');
    expect(document.activeElement).toBe(document.querySelector('[role="menuitem"]'));
    menuItem('Interview Scheduled').click();
    await flush();
    expect(a.setStatus).toHaveBeenCalledWith('a', 'interview_scheduled');
    expect(document.querySelector('.menu')).toBeNull();
  });

  it('does nothing when the card is moved to its current status', async () => {
    const a = actions();
    renderKanban(host, [acme], a, { now: () => NOW });
    open('a');
    menuItem('Applied').click();
    await flush();
    expect(a.setStatus).not.toHaveBeenCalled();
  });

  it('closes the menu with Escape and returns focus to the button', () => {
    renderKanban(host, [acme], actions(), { now: () => NOW });
    open('a');
    document.querySelector('.menu')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.menu')).toBeNull();
    expect(document.activeElement).toBe(cardIn('a').querySelector('.kcard-menu-btn'));
  });

  it('edits company and role', async () => {
    const a = actions();
    renderKanban(host, [acme], a, { now: () => NOW });
    open('a');
    menuItem('Edit…').click();
    (document.getElementById('edit-company') as HTMLInputElement).value = ' Acme Labs ';
    (document.getElementById('edit-role') as HTMLInputElement).value = 'Staff Engineer';
    dialogButton('Save').click();
    await flush();
    expect(a.edit).toHaveBeenCalledWith('a', { company: 'Acme Labs', role: 'Staff Engineer' });
  });

  it('does not save an edit with a blank field or when cancelled', async () => {
    const a = actions();
    renderKanban(host, [acme], a, { now: () => NOW });
    open('a');
    menuItem('Edit…').click();
    (document.getElementById('edit-company') as HTMLInputElement).value = '  ';
    dialogButton('Save').click();
    await flush();
    open('a');
    menuItem('Edit…').click();
    dialogButton('Cancel').click();
    await flush();
    expect(a.edit).not.toHaveBeenCalled();
  });

  it('deletes only after confirmation (R7.5)', async () => {
    const a = actions();
    renderKanban(host, [acme], a, { now: () => NOW });
    open('a');
    menuItem('Delete…').click();
    dialogButton('Cancel').click();
    await flush();
    expect(a.remove).not.toHaveBeenCalled();

    open('a');
    menuItem('Delete…').click();
    expect(document.querySelector('.dialog')!.textContent).toContain('Acme');
    dialogButton('Delete').click();
    await flush();
    expect(a.remove).toHaveBeenCalledWith('a');
  });

  it('labels each menu button with the application it belongs to', () => {
    renderKanban(host, [acme], actions(), { now: () => NOW });
    expect(cardIn('a').querySelector('.kcard-menu-btn')!.getAttribute('aria-label')).toBe('Actions for Acme — Software Engineer');
  });
});

describe('renderKanban: drag and drop (R7.4)', () => {
  it('sets the dropped column’s status', async () => {
    const a = actions();
    renderKanban(host, [acme], a, { now: () => NOW });
    drop(column('offer'), 'a');
    await flush();
    expect(a.setStatus).toHaveBeenCalledWith('a', 'offer');
  });

  it('asks rejected or withdrawn when dropped on Closed', async () => {
    const a = actions();
    renderKanban(host, [acme], a, { now: () => NOW });
    drop(column('closed'), 'a');
    await flush();
    dialogButton('Withdrawn').click();
    await flush();
    expect(a.setStatus).toHaveBeenCalledWith('a', 'withdrawn');
  });

  it('does nothing if the Closed choice is cancelled or the card is unknown', async () => {
    const a = actions();
    renderKanban(host, [acme], a, { now: () => NOW });
    drop(column('closed'), 'a');
    await flush();
    dialogButton('Cancel').click();
    drop(column('offer'), 'nope');
    await flush();
    expect(a.setStatus).not.toHaveBeenCalled();
  });

  it('ignores drops of other things', async () => {
    const a = actions();
    renderKanban(host, [acme], a, { now: () => NOW });
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['text/plain'], getData: () => 'a' } });
    column('offer').dispatchEvent(ev);
    await flush();
    expect(a.setStatus).not.toHaveBeenCalled();
  });
});
