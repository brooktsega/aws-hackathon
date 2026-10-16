import { describe, expect, it } from 'vitest';
import {
  createDeleteApplicationHandler,
  createDismissAlertHandler,
  createSaveAnalysisHandler,
  createSetStatusHandler,
  createUpdateApplicationHandler,
} from '../../src/background/persist';
import { createStore } from '../../src/background/storage';
import { STORAGE_KEYS } from '../../src/shared/constants';
import type { AnalysisPreview, StoredState } from '../../src/shared/types';
import { createMemoryArea } from '../chrome-stub';
import { DAY, T0, makeAnalysis, makeEmail } from '../helpers';

const sender = { id: 'e' };
const NOW = T0 + 2 * DAY;
let n = 0;

function setup() {
  const area = createMemoryArea();
  const store = createStore(area);
  let now = NOW;
  const deps = { store, now: () => now, newId: () => `app-${++n}` };
  return {
    area,
    store,
    setNow: (t: number) => (now = t),
    save: createSaveAnalysisHandler(deps),
    setStatus: createSetStatusHandler(deps),
    update: createUpdateApplicationHandler(deps),
    remove: createDeleteApplicationHandler(deps),
    dismiss: createDismissAlertHandler(deps),
    state: (): Promise<StoredState> => store.load(),
  };
}

const preview = (analysis = makeAnalysis(), email = makeEmail()): AnalysisPreview => ({ email, analysis, truncated: false });
const accept = (p: AnalysisPreview) => ({
  preview: p,
  edits: { company: p.analysis.company, role: p.analysis.role, status: p.analysis.status },
});
const FUTURE = new Date(NOW + 3 * DAY).toISOString();

describe('SAVE_ANALYSIS (R5, R6, R9)', () => {
  it('creates an application and records the processed email', async () => {
    const t = setup();
    const r = await t.save(accept(preview()), sender);
    expect(r.ok).toBe(true);
    const state = await t.state();
    const apps = Object.values(state.applications);
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ company: 'Acme', role: 'Software Engineer', status: 'applied' });
    expect(state.processed).toEqual({ 'key-1': apps[0]!.id });
    expect(r.ok && r.data.applicationId).toBe(apps[0]!.id);
  });

  it('applies the user edits from the result card', async () => {
    const t = setup();
    await t.save({ preview: preview(), edits: { company: 'Globex', role: 'Data Analyst', status: 'screening' } }, sender);
    const app = Object.values((await t.state()).applications)[0]!;
    expect(app).toMatchObject({ company: 'Globex', role: 'Data Analyst', status: 'screening' });
  });

  it('saving the same email twice keeps one history entry (R5.9)', async () => {
    const t = setup();
    await t.save(accept(preview()), sender);
    await t.save(accept(preview()), sender);
    const apps = Object.values((await t.state()).applications);
    expect(apps).toHaveLength(1);
    expect(apps[0]!.history).toHaveLength(1);
  });

  it('merges a later email into the same application', async () => {
    const t = setup();
    await t.save(accept(preview()), sender);
    await t.save(
      accept(preview(makeAnalysis({ status: 'rejected', emailKind: 'rejection' }), makeEmail({ messageKey: 'key-2', date: T0 + DAY }))),
      sender,
    );
    const apps = Object.values((await t.state()).applications);
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ status: 'rejected', rejectedAt: T0 + DAY });
  });

  it('creates event alerts and links them to the application (R9.1)', async () => {
    const t = setup();
    await t.save(
      accept(preview(makeAnalysis({ emailKind: 'interview_invite', status: 'interview_scheduled', upcomingEvents: [{ type: 'interview', title: 'Onsite', startsAt: FUTURE }] }))),
      sender,
    );
    const state = await t.state();
    const alerts = Object.values(state.alerts);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'upcoming_event', title: 'Onsite', state: 'active', firmKnown: true });
    expect(alerts[0]!.applicationId).toBe(Object.keys(state.applications)[0]);
  });

  it('saves alert-only emails without creating an application (R4.6)', async () => {
    const t = setup();
    const p = preview(
      makeAnalysis({ emailKind: 'new_opportunity', status: null, opportunities: [{ title: 'Staff Engineer', location: 'Remote' }] }),
    );
    const r = await t.save(accept(p), sender);
    expect(r).toEqual({ ok: true, data: { applicationId: null } });
    const state = await t.state();
    expect(Object.keys(state.applications)).toHaveLength(0);
    expect(Object.values(state.alerts)).toMatchObject([{ type: 'new_opportunity', title: 'Staff Engineer', firmKnown: false }]);
    expect(state.processed).toEqual({ 'key-1': '' });
  });

  it('marks a new opportunity from a tracked firm as known (R9.3)', async () => {
    const t = setup();
    await t.save(accept(preview()), sender);
    await t.save(
      accept(preview(makeAnalysis({ emailKind: 'new_opportunity', status: null, opportunities: [{ title: 'PM', location: null }] }), makeEmail({ messageKey: 'key-2' }))),
      sender,
    );
    expect(Object.values((await t.state()).alerts)[0]).toMatchObject({ type: 'new_opportunity', firmKnown: true });
  });

  it('dismisses open event alerts when the application becomes rejected (R9.10)', async () => {
    const t = setup();
    await t.save(
      accept(preview(makeAnalysis({ status: 'interview_scheduled', upcomingEvents: [{ type: 'interview', title: 'Call', startsAt: FUTURE }] }))),
      sender,
    );
    await t.save(
      accept(preview(makeAnalysis({ status: 'rejected', emailKind: 'rejection' }), makeEmail({ messageKey: 'key-2', date: NOW }))),
      sender,
    );
    expect(Object.values((await t.state()).alerts)[0]!.state).toBe('dismissed');
  });

  it('does not recreate a dismissed alert when the email is saved again (R9.9)', async () => {
    const t = setup();
    const p = preview(makeAnalysis({ upcomingEvents: [{ type: 'interview', title: 'Call', startsAt: FUTURE }] }));
    await t.save(accept(p), sender);
    const id = Object.keys((await t.state()).alerts)[0]!;
    await t.dismiss({ alertId: id }, sender);
    await t.save(accept(p), sender);
    const alerts = Object.values((await t.state()).alerts);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.state).toBe('dismissed');
  });

  it('rejects malformed requests and a status without a company', async () => {
    const t = setup();
    expect(await t.save(undefined as never, sender)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(await t.save({ preview: preview(), edits: { company: 'A', role: null, status: 'hired' as never } }, sender)).toMatchObject({ ok: false });
    expect(await t.save({ preview: preview(), edits: { company: '  ', role: null, status: 'applied' } }, sender)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(await t.save({ preview: { ...preview(), email: { subject: 1 } } as never, edits: { company: 'A', role: null, status: 'applied' } }, sender)).toMatchObject({ ok: false });
    expect(t.area.setCalls).toHaveLength(0);
  });

  it('leaves data unchanged and reports STORAGE_WRITE_FAILED when the write fails (R6.4)', async () => {
    const t = setup();
    await t.save(accept(preview()), sender);
    const before = structuredClone(t.area.data);
    t.area.failNextSet();
    const r = await t.save(accept(preview(makeAnalysis({ company: 'Globex' }), makeEmail({ messageKey: 'key-9' }))), sender);
    expect(r).toMatchObject({ ok: false, error: { code: 'STORAGE_WRITE_FAILED' } });
    expect(t.area.data).toEqual(before);
  });
});

describe('SET_STATUS_MANUAL (R7.4)', () => {
  it('adds a manual history entry dated now and updates the status', async () => {
    const t = setup();
    await t.save(accept(preview()), sender);
    const id = Object.keys((await t.state()).applications)[0]!;
    t.setNow(NOW + DAY);
    expect(await t.setStatus({ applicationId: id, status: 'screening' }, sender)).toEqual({ ok: true, data: undefined });
    const app = (await t.state()).applications[id]!;
    expect(app.status).toBe('screening');
    expect(app.history.at(-1)).toEqual({ status: 'screening', at: NOW + DAY, source: 'manual' });
  });

  it('is a no-op when the status is unchanged', async () => {
    const t = setup();
    await t.save(accept(preview()), sender);
    const id = Object.keys((await t.state()).applications)[0]!;
    const writes = t.area.setCalls.length;
    await t.setStatus({ applicationId: id, status: 'applied' }, sender);
    expect(t.area.setCalls).toHaveLength(writes);
  });

  it('dismisses event alerts when moved to a closed status', async () => {
    const t = setup();
    await t.save(accept(preview(makeAnalysis({ upcomingEvents: [{ type: 'interview', title: 'Call', startsAt: FUTURE }] }))), sender);
    const id = Object.keys((await t.state()).applications)[0]!;
    await t.setStatus({ applicationId: id, status: 'withdrawn' }, sender);
    expect(Object.values((await t.state()).alerts)[0]!.state).toBe('dismissed');
  });

  it('rejects unknown applications and bad statuses', async () => {
    const t = setup();
    expect(await t.setStatus({ applicationId: 'nope', status: 'offer' }, sender)).toMatchObject({ ok: false });
    expect(await t.setStatus({ applicationId: 'x', status: 'hired' as never }, sender)).toMatchObject({ ok: false });
  });
});

describe('UPDATE_APPLICATION / DELETE_APPLICATION (R7.5)', () => {
  it('edits company and role and refreshes the match keys', async () => {
    const t = setup();
    await t.save(accept(preview()), sender);
    const id = Object.keys((await t.state()).applications)[0]!;
    await t.update({ applicationId: id, fields: { company: 'Acme Labs, Inc.', role: 'Sr. Engineer' } }, sender);
    expect((await t.state()).applications[id]).toMatchObject({
      company: 'Acme Labs, Inc.',
      companyKey: 'acme labs',
      role: 'Sr. Engineer',
      roleKey: 'senior engineer',
    });
  });

  it('rejects blank values and unknown ids', async () => {
    const t = setup();
    await t.save(accept(preview()), sender);
    const id = Object.keys((await t.state()).applications)[0]!;
    expect(await t.update({ applicationId: id, fields: { company: '  ' } }, sender)).toMatchObject({ ok: false });
    expect(await t.update({ applicationId: 'nope', fields: { company: 'X' } }, sender)).toMatchObject({ ok: false });
  });

  it('deletes the application, its alerts, and its processed keys so it can be re-added', async () => {
    const t = setup();
    const p = preview(makeAnalysis({ upcomingEvents: [{ type: 'interview', title: 'Call', startsAt: FUTURE }] }));
    await t.save(accept(p), sender);
    const id = Object.keys((await t.state()).applications)[0]!;
    expect(await t.remove({ applicationId: id }, sender)).toEqual({ ok: true, data: undefined });
    const state = await t.state();
    expect(state.applications).toEqual({});
    expect(state.alerts).toEqual({});
    expect(state.processed).toEqual({});
    await t.save(accept(p), sender);
    expect(Object.keys((await t.state()).applications)).toHaveLength(1);
  });

  it('succeeds quietly for an application that is already gone', async () => {
    const t = setup();
    expect(await t.remove({ applicationId: 'gone' }, sender)).toEqual({ ok: true, data: undefined });
  });
});

describe('DISMISS_ALERT (R9.6)', () => {
  it('dismisses one alert', async () => {
    const t = setup();
    await t.save(accept(preview(makeAnalysis({ upcomingEvents: [{ type: 'deadline', title: 'Form', startsAt: FUTURE }] }))), sender);
    const id = Object.keys((await t.state()).alerts)[0]!;
    await t.dismiss({ alertId: id }, sender);
    expect((await t.state()).alerts[id]!.state).toBe('dismissed');
    expect(t.area.data[STORAGE_KEYS.alerts]).toBeDefined();
  });

  it('rejects a malformed request', async () => {
    expect(await setup().dismiss({ alertId: '' }, sender)).toMatchObject({ ok: false });
  });
});
