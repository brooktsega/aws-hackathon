import { describe, expect, it } from 'vitest';
import { EMAIL_KINDS, EVIDENCE_MAX_CHARS, NON_STATUS_EMAIL_KINDS } from '../../src/shared/constants';
import {
  ANALYSIS_SCHEMA,
  parseAnalysisJson,
  sanitizeAnalysis,
  validateAnalysis,
} from '../../src/domain/schema';
import type { AnalysisResult } from '../../src/shared/types';

const base = (): AnalysisResult => ({
  emailKind: 'application_confirmation',
  company: 'Acme',
  role: 'Software Engineer',
  status: 'applied',
  confidence: 'high',
  evidence: 'Thanks for applying to Acme',
  upcomingEvents: [],
  opportunities: [],
});

const errorOf = (value: unknown) => {
  const r = validateAnalysis(value);
  if (r.ok) throw new Error('expected validation to fail');
  return r.error;
};

describe('ANALYSIS_SCHEMA', () => {
  it('requires every property and forbids extras at every level', () => {
    expect(ANALYSIS_SCHEMA.additionalProperties).toBe(false);
    expect([...ANALYSIS_SCHEMA.required].sort()).toEqual(
      Object.keys(ANALYSIS_SCHEMA.properties).sort(),
    );
    expect(ANALYSIS_SCHEMA.properties.upcomingEvents.items.additionalProperties).toBe(false);
    expect(ANALYSIS_SCHEMA.properties.opportunities.items.additionalProperties).toBe(false);
  });

  it('lists every email kind', () => {
    expect(ANALYSIS_SCHEMA.properties.emailKind.enum).toEqual([...EMAIL_KINDS]);
  });
});

describe('validateAnalysis', () => {
  it.each(EMAIL_KINDS)('accepts a valid result with emailKind %s', (emailKind) => {
    const r = validateAnalysis({ ...base(), emailKind });
    expect(r.ok).toBe(true);
  });

  it('accepts null company, role, and status', () => {
    const r = validateAnalysis({ ...base(), company: null, role: null, status: null });
    expect(r.ok).toBe(true);
  });

  it('accepts events and opportunities', () => {
    const r = validateAnalysis({
      ...base(),
      upcomingEvents: [{ type: 'interview', title: 'Onsite', startsAt: '2026-11-03T14:00:00-05:00' }],
      opportunities: [{ title: 'Staff Engineer', location: null }],
    });
    expect(r.ok).toBe(true);
  });

  it.each([null, undefined, 'text', 42, [], true])('rejects non-object %j', (value) => {
    expect(errorOf(value).code).toBe('INVALID_MODEL_OUTPUT');
  });

  it('rejects unknown emailKind, status, and confidence values', () => {
    expect(errorOf({ ...base(), emailKind: 'spam' }).message).toContain('emailKind');
    expect(errorOf({ ...base(), status: 'hired' }).message).toContain('status');
    expect(errorOf({ ...base(), confidence: 'certain' }).message).toContain('confidence');
  });

  it.each(Object.keys(base()))('rejects a result missing %s', (key) => {
    const value: Record<string, unknown> = { ...base() };
    delete value[key];
    expect(errorOf(value).message).toContain(`${key} is missing`);
  });

  it('rejects wrong field types', () => {
    expect(errorOf({ ...base(), company: 5 }).message).toContain('company');
    expect(errorOf({ ...base(), role: undefined }).message).toContain('role');
    expect(errorOf({ ...base(), evidence: null }).message).toContain('evidence');
    expect(errorOf({ ...base(), upcomingEvents: 'none' }).message).toContain('upcomingEvents');
    expect(errorOf({ ...base(), opportunities: {} }).message).toContain('opportunities');
  });

  it('rejects extra keys at the top level', () => {
    expect(errorOf({ ...base(), notes: 'hi' }).message).toContain('notes is not allowed');
  });

  it('rejects malformed nested events', () => {
    const ev = { type: 'interview', title: 'Call', startsAt: null };
    expect(errorOf({ ...base(), upcomingEvents: [{ ...ev, type: 'party' }] }).message).toContain(
      'upcomingEvents[0].type',
    );
    expect(errorOf({ ...base(), upcomingEvents: [{ ...ev, extra: 1 }] }).message).toContain(
      'extra is not allowed',
    );
    expect(errorOf({ ...base(), upcomingEvents: [{ type: 'interview', title: 'x' }] }).message).toContain(
      'startsAt is missing',
    );
    expect(errorOf({ ...base(), upcomingEvents: [{ ...ev, startsAt: 123 }] }).message).toContain(
      'startsAt must be a string or null',
    );
    expect(errorOf({ ...base(), upcomingEvents: ['x'] }).message).toContain('not an object');
  });

  it('rejects malformed nested opportunities', () => {
    expect(errorOf({ ...base(), opportunities: [{ title: 5, location: null }] }).message).toContain(
      'opportunities[0].title',
    );
    expect(errorOf({ ...base(), opportunities: [{ title: 'x' }] }).message).toContain(
      'location is missing',
    );
  });
});

describe('sanitizeAnalysis', () => {
  it('trims text and turns blank company, role, and location into null', () => {
    const out = sanitizeAnalysis({
      ...base(),
      company: '  Acme  ',
      role: '   ',
      upcomingEvents: [{ type: 'other', title: ' Chat ', startsAt: '  ' }],
      opportunities: [{ title: ' PM ', location: '' }],
    });
    expect(out.company).toBe('Acme');
    expect(out.role).toBeNull();
    expect(out.upcomingEvents).toEqual([{ type: 'other', title: 'Chat', startsAt: null }]);
    expect(out.opportunities).toEqual([{ title: 'PM', location: null }]);
  });

  it.each(NON_STATUS_EMAIL_KINDS)('forces status to null for emailKind %s (R4.6)', (emailKind) => {
    expect(sanitizeAnalysis({ ...base(), emailKind, status: 'rejected' }).status).toBeNull();
  });

  it('keeps the status for status-bearing email kinds', () => {
    expect(sanitizeAnalysis({ ...base(), emailKind: 'rejection', status: 'rejected' }).status).toBe(
      'rejected',
    );
  });

  it('caps the evidence quote', () => {
    const out = sanitizeAnalysis({ ...base(), evidence: ` ${'x'.repeat(500)} ` });
    expect(out.evidence).toHaveLength(EVIDENCE_MAX_CHARS);
  });

  it('does not mutate its input', () => {
    const input = { ...base(), company: ' Acme ' };
    sanitizeAnalysis(input);
    expect(input.company).toBe(' Acme ');
  });
});

describe('parseAnalysisJson', () => {
  it('parses, validates, and sanitizes valid JSON', () => {
    const r = parseAnalysisJson(JSON.stringify({ ...base(), company: ' Acme ' }));
    expect(r).toEqual({ ok: true, data: { ...base(), company: 'Acme' } });
  });

  it('rejects text that is not JSON', () => {
    const r = parseAnalysisJson('Sure! Here is the JSON: {');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_MODEL_OUTPUT');
  });

  it('rejects JSON that fails validation', () => {
    expect(parseAnalysisJson('{"company":"Acme"}').ok).toBe(false);
  });
});
