import { describe, expect, it } from 'vitest';
import {
  KANBAN_COLUMNS,
  NON_STATUS_EMAIL_KINDS,
  EMAIL_KINDS,
  STATUSES,
  STATUS_LABELS,
} from '../../src/shared/constants';
import { MESSAGE_TYPES } from '../../src/shared/messages';

describe('shared constants', () => {
  it('maps every status to exactly one Kanban column', () => {
    const mapped = KANBAN_COLUMNS.flatMap((c) => [...c.statuses]);
    expect([...mapped].sort()).toEqual([...STATUSES].sort());
  });

  it('places rejected and withdrawn in the Closed column (R7.2)', () => {
    const closed = KANBAN_COLUMNS.find((c) => c.id === 'closed');
    expect(closed?.statuses).toEqual(['rejected', 'withdrawn']);
  });

  it('has a label for every status', () => {
    expect(Object.keys(STATUS_LABELS).sort()).toEqual([...STATUSES].sort());
  });

  it('only lists real email kinds as non-status kinds', () => {
    for (const kind of NON_STATUS_EMAIL_KINDS) expect(EMAIL_KINDS).toContain(kind);
  });

  it('has unique message types', () => {
    expect(new Set(MESSAGE_TYPES).size).toBe(MESSAGE_TYPES.length);
  });
});
