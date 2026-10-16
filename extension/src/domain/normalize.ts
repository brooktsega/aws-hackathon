// Company/role normalization and matching (R5.1, design §8.1–8.2). Pure functions.
import { ROLE_MATCH_THRESHOLD } from '../shared/constants';

const LEGAL_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company',
  'gmbh', 'plc', 'ag', 'sa', 'lp', 'llp', 'pllc', 'bv', 'nv', 'pty',
]);

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b([a-z])\.(?=[a-z](?:\.|\b))/g, '$1') // "s.a." -> "sa."
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Acme, Inc." -> "acme". Falls back to the folded text if stripping would empty it. */
export function normalizeCompany(name: string): string {
  const folded = fold(name);
  const words = folded.split(' ').filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1] as string)) words.pop();
  if (words.length > 1 && words[0] === 'the') words.shift();
  return words.join(' ');
}

const ROLE_ABBREVIATIONS: Record<string, string> = {
  sr: 'senior',
  jr: 'junior',
  mgr: 'manager',
  dev: 'developer',
};

// Requisition ids in brackets, e.g. "(R-12345)", "[Req 20481]", "(Job ID: 9981)".
const BRACKETED_ID = /[([{]\s*(?:req(?:uisition)?|job|id|r)?[\s#:.-]*(?:id)?[\s#:.-]*[a-z]?-?\d{3,}\s*[)\]}]/gi;
// A trailing id after a dash, e.g. "Software Engineer - R12345".
const TRAILING_ID = /\s[-–—]\s*(?:req(?:uisition)?|job|id|r)?[\s#:.-]*[a-z]?-?\d{4,}\s*$/i;

/** "Sr. Software Engineer (R-12345)" -> "senior software engineer". Empty for unknown. */
export function normalizeRole(role: string): string {
  const stripped = role.replace(BRACKETED_ID, ' ').replace(TRAILING_ID, ' ');
  return fold(stripped)
    .split(' ')
    .filter(Boolean)
    .map((w) => ROLE_ABBREVIATIONS[w] ?? w)
    .join(' ');
}

const ROLE_STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'of', 'for', 'to', 'in', 'at']);

export function roleTokens(roleKey: string): Set<string> {
  return new Set(roleKey.split(' ').filter((w) => w && !ROLE_STOP_WORDS.has(w)));
}

export function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Two normalized roles match when equal or when their token sets overlap enough.
 * An unknown (empty) role matches only another unknown role; the merge engine
 * decides how to treat unknown roles.
 */
export function rolesMatch(roleKeyA: string, roleKeyB: string): boolean {
  if (roleKeyA === roleKeyB) return true;
  if (roleKeyA === '' || roleKeyB === '') return false;
  return jaccard(roleTokens(roleKeyA), roleTokens(roleKeyB)) >= ROLE_MATCH_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Sender domains: a weak hint that two company names refer to the same firm.

/** Mail providers, job boards and applicant-tracking vendors: they say nothing about the employer. */
const GENERIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com',
  'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com',
  'greenhouse.io', 'greenhouse-mail.io', 'lever.co', 'myworkday.com', 'workday.com',
  'workdaymail.com', 'ashbyhq.com', 'smartrecruiters.com', 'icims.com', 'jobvite.com',
  'taleo.net', 'bamboohr.com', 'successfactors.com', 'successfactors.eu', 'breezy.hr',
  'workable.com', 'recruitee.com', 'teamtailor.com', 'rippling.com', 'gem.com',
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com', 'wellfound.com',
  'handshake.com', 'joinhandshake.com',
]);

const SECOND_LEVEL_LABELS = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);

/** Registrable-ish domain of an email address, or null for generic/ATS/mail providers. */
export function companyDomain(address: string): string | null {
  const at = address.lastIndexOf('@');
  const host = (at >= 0 ? address.slice(at + 1) : address).trim().toLowerCase();
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return null;
  const last = labels[labels.length - 1] as string;
  const prev = labels[labels.length - 2] as string;
  const take = last.length === 2 && SECOND_LEVEL_LABELS.has(prev) && labels.length >= 3 ? 3 : 2;
  const domain = labels.slice(-take).join('.');
  return GENERIC_DOMAINS.has(domain) ? null : domain;
}

export interface CompanyRef {
  companyKey: string;
  senderDomains: readonly string[];
}

const keyWords = (companyKey: string): Set<string> => new Set(companyKey.split(' ').filter(Boolean));

function isSubset<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Same normalized name, or a shared employer domain plus one name's words
 * contained in the other's ("Acme" vs "Acme Labs" both mailing from acme.com).
 */
export function companiesMatch(a: CompanyRef, b: CompanyRef): boolean {
  if (a.companyKey === '' || b.companyKey === '') return false;
  if (a.companyKey === b.companyKey) return true;
  const shareDomain = a.senderDomains.some((d) => b.senderDomains.includes(d));
  if (!shareDomain) return false;
  const wa = keyWords(a.companyKey);
  const wb = keyWords(b.companyKey);
  return isSubset(wa, wb) || isSubset(wb, wa);
}
