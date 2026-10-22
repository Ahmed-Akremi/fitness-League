import type { Json } from '../../../core/api/client';
import { fromMillimes, toMillimes } from './logic';

/**
 * Organisation update, phase 3: what a division adds to the server's category, kept on the device per category id
 * (`categoryFields` in `core/api/org-local.ts`). Teams and their composition, one level of sub-divisions, a division
 * locked behind a 6-digit code, an early-bird price, and the team rules.
 */

export type DivisionType = 'INDIVIDUAL' | 'TEAM';

export type DivisionDraft = {
  type: DivisionType;
  teamMale: string;
  teamFemale: string;
  parentId: string | null;
  locked: boolean;
  unlockCode: string | null;
  earlyPrice: string;
  earlyUntil: Date | null;
  teamNameChangeUntil: Date | null;
  memberChangeUntil: Date | null;
  memberChangePrice: string;
  oneMemberStays: boolean;
};

export type DivisionProblem = 'TEAM_SIZE' | 'PARENT' | 'CODE' | 'EARLY_PRICE' | 'EARLY_DATE' | 'CHANGE_PRICE';

const date = (v: unknown) => (typeof v === 'string' ? new Date(v) : null);
const count = (v: unknown) => (typeof v === 'number' ? String(v) : '');

export function divisionDraft(cat: Json | null): DivisionDraft {
  const k = cat ?? {};
  return {
    type: k.type === 'TEAM' ? 'TEAM' : 'INDIVIDUAL',
    teamMale: count(k.teamMale),
    teamFemale: count(k.teamFemale),
    parentId: typeof k.parentId === 'string' ? k.parentId : null,
    locked: k.locked === true,
    unlockCode: typeof k.unlockCode === 'string' ? k.unlockCode : null,
    earlyPrice: k.earlyPrice != null ? fromMillimes(k.earlyPrice) : '',
    earlyUntil: date(k.earlyUntil),
    teamNameChangeUntil: date(k.teamNameChangeUntil),
    memberChangeUntil: date(k.memberChangeUntil),
    memberChangePrice: k.memberChangePrice != null ? fromMillimes(k.memberChangePrice) : '',
    oneMemberStays: k.oneMemberStays === true,
  };
}

const wholeOrZero = (s: string) => (s.trim() ? Number(s.trim()) : 0);
const validCount = (s: string) => !s.trim() || (Number.isInteger(Number(s.trim())) && Number(s.trim()) >= 0 && Number(s.trim()) <= 20);

/** `basePrice`: what the division costs otherwise (its own price or the event's); `registrationEnd`: when registration closes. */
export function divisionProblems(d: DivisionDraft, ctx: { categoryId?: string; categories: Json[]; basePrice: number | null; registrationEnd: string }): DivisionProblem[] {
  const problems: DivisionProblem[] = [];
  if (d.type === 'TEAM' && (!validCount(d.teamMale) || !validCount(d.teamFemale) || wholeOrZero(d.teamMale) + wholeOrZero(d.teamFemale) < 2)) problems.push('TEAM_SIZE');
  if (d.parentId) {
    const parent = ctx.categories.find((k) => k.id === d.parentId);
    if (!parent || d.parentId === ctx.categoryId || parent.parentId || ctx.categories.some((k) => k.parentId === ctx.categoryId && ctx.categoryId)) problems.push('PARENT');
  }
  if (d.locked && !/^\d{6}$/.test(d.unlockCode ?? '')) problems.push('CODE');
  if (d.earlyPrice.trim()) {
    const early = toMillimes(d.earlyPrice);
    if (early == null || (ctx.basePrice != null && early >= ctx.basePrice)) problems.push('EARLY_PRICE');
    if (!d.earlyUntil || d.earlyUntil.getTime() > new Date(ctx.registrationEnd).getTime()) problems.push('EARLY_DATE');
  }
  if (d.memberChangePrice.trim() && toMillimes(d.memberChangePrice) == null) problems.push('CHANGE_PRICE');
  return problems;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function divisionBody(d: DivisionDraft): Json {
  const team = d.type === 'TEAM';
  const early = d.earlyPrice.trim() ? toMillimes(d.earlyPrice) : null;
  return {
    type: d.type,
    teamMale: team ? wholeOrZero(d.teamMale) : null,
    teamFemale: team ? wholeOrZero(d.teamFemale) : null,
    parentId: d.parentId,
    locked: d.locked,
    unlockCode: d.locked ? d.unlockCode : null,
    earlyPrice: early,
    earlyUntil: early != null ? iso(d.earlyUntil) : null,
    teamNameChangeUntil: team ? iso(d.teamNameChangeUntil) : null,
    memberChangeUntil: team ? iso(d.memberChangeUntil) : null,
    memberChangePrice: team && d.memberChangePrice.trim() ? toMillimes(d.memberChangePrice) : null,
    oneMemberStays: team && d.oneMemberStays,
  };
}

export const teamSize = (cat: Json) => (cat.teamMale ?? 0) + (cat.teamFemale ?? 0);

/** Top-level divisions in their order, each with its sub-divisions in theirs. A sub-division whose parent is gone shows at the top. */
export function divisionTree(categories: Json[]): { parent: Json; children: Json[] }[] {
  const sorted = [...categories].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const ids = new Set(sorted.map((k) => k.id));
  return sorted
    .filter((k) => !k.parentId || !ids.has(k.parentId))
    .map((parent) => ({ parent, children: sorted.filter((k) => k.parentId === parent.id) }));
}
