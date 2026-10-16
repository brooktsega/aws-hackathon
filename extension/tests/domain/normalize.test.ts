import { describe, expect, it } from 'vitest';
import {
  companiesMatch,
  companyDomain,
  jaccard,
  normalizeCompany,
  normalizeRole,
  rolesMatch,
} from '../../src/domain/normalize';

describe('normalizeCompany', () => {
  it.each([
    ['Acme', 'acme'],
    ['Acme, Inc.', 'acme'],
    ['ACME Corp', 'acme'],
    ['Acme Corporation LLC', 'acme'],
    ['The Boston Consulting Group', 'boston consulting group'],
    ['  Globex   GmbH ', 'globex'],
    ['AT&T', 'at and t'],
    ['Café Société S.A.', 'cafe societe'],
    ['Inc', 'inc'], // never stripped to empty
    ['Co', 'co'],
    ['', ''],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeCompany(input)).toBe(expected);
  });
});

describe('normalizeRole', () => {
  it.each([
    ['Software Engineer', 'software engineer'],
    ['Sr. Software Engineer', 'senior software engineer'],
    ['Jr Data Analyst', 'junior data analyst'],
    ['Software Engineer (R-12345)', 'software engineer'],
    ['Software Engineer [Req 20481]', 'software engineer'],
    ['Software Engineer (Job ID: 9981)', 'software engineer'],
    ['Software Engineer - R12345', 'software engineer'],
    ['Product Manager, Growth', 'product manager growth'],
    ['Engineer (L5)', 'engineer l5'], // short level tags are not requisition ids
    ['', ''],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeRole(input)).toBe(expected);
  });
});

describe('rolesMatch', () => {
  const m = (a: string, b: string) => rolesMatch(normalizeRole(a), normalizeRole(b));

  it('matches equal and near-equal roles', () => {
    expect(m('Software Engineer', 'software engineer')).toBe(true);
    expect(m('Sr. Software Engineer', 'Senior Software Engineer')).toBe(true);
    expect(m('Software Engineer (R-1001)', 'Software Engineer')).toBe(true);
    expect(m('Backend Software Engineer', 'Backend Software Engineer, Payments')).toBe(true); // 3/4 = 0.75
  });

  it('matches when token overlap reaches the threshold', () => {
    expect(rolesMatch('data science intern summer', 'data science intern')).toBe(true); // 3/4 = 0.75
  });

  it('does not match different roles', () => {
    expect(m('Software Engineer', 'Product Manager')).toBe(false);
    expect(m('Software Engineer II', 'Software Engineer III')).toBe(false);
    expect(m('Senior Software Engineer', 'Software Engineer')).toBe(false); // 2/3 < 0.7
  });

  it('treats unknown roles as matching only each other', () => {
    expect(rolesMatch('', '')).toBe(true);
    expect(rolesMatch('', 'software engineer')).toBe(false);
  });
});

describe('jaccard', () => {
  it('computes set similarity', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBe(1);
    expect(jaccard(new Set(['a']), new Set())).toBe(0);
  });
});

describe('companyDomain', () => {
  it.each([
    ['recruiting@acme.com', 'acme.com'],
    ['jobs@careers.acme.com', 'acme.com'],
    ['hr@acme.co.uk', 'acme.co.uk'],
    ['no-reply@us.greenhouse.io', null],
    ['someone@gmail.com', null],
    ['talent@myworkday.com', null],
    ['x@jobs.lever.co', null],
    ['not-an-address', null],
  ])('%s -> %s', (address, expected) => {
    expect(companyDomain(address)).toBe(expected);
  });
});

describe('companiesMatch', () => {
  const ref = (companyKey: string, senderDomains: string[] = []) => ({ companyKey, senderDomains });

  it('matches identical normalized names', () => {
    expect(companiesMatch(ref('acme'), ref('acme'))).toBe(true);
  });

  it('never matches empty names', () => {
    expect(companiesMatch(ref(''), ref(''))).toBe(false);
  });

  it('does not match different names without a shared domain', () => {
    expect(companiesMatch(ref('acme'), ref('acme labs'))).toBe(false);
  });

  it('matches a name subset when a domain is shared', () => {
    expect(companiesMatch(ref('acme', ['acme.com']), ref('acme labs', ['acme.com']))).toBe(true);
  });

  it('does not match unrelated names even with a shared domain', () => {
    expect(companiesMatch(ref('acme', ['x.com']), ref('globex', ['x.com']))).toBe(false);
  });
});
