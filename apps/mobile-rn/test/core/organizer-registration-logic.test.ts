import { divisionBody, divisionDraft, divisionProblems, divisionTree, teamSize } from '../../src/features/competitions/organizer/logic-division';
import { agreementProblems, agreementsOf, answerProblems, fieldProblems, formOf, moveField } from '../../src/features/competitions/organizer/logic-forms';
import { effectivePrice, priceBreakdown, pricingBody, pricingDraft, pricingOf, pricingProblems } from '../../src/features/competitions/organizer/logic-pricing';

describe('divisions (team composition, sub-divisions, locks, early-bird)', () => {
  const ctx = { categories: [{ id: 'k1', name: 'RX' }, { id: 'k2', name: 'Scaled', parentId: 'k1' }], basePrice: 40000, registrationEnd: '2026-12-01T22:00:00.000Z' };

  it('reads an existing category as an individual division without extras', () => {
    expect(divisionDraft({ id: 'k1' })).toMatchObject({ type: 'INDIVIDUAL', teamMale: '', teamFemale: '', parentId: null, locked: false, unlockCode: null, earlyPrice: '', earlyUntil: null });
  });

  it('needs at least two athletes in a team', () => {
    expect(divisionProblems({ ...divisionDraft(null), type: 'TEAM', teamMale: '1', teamFemale: '0' }, ctx)).toEqual(['TEAM_SIZE']);
    expect(divisionProblems({ ...divisionDraft(null), type: 'TEAM', teamMale: '1', teamFemale: '1' }, ctx)).toEqual([]);
  });

  it('keeps sub-divisions one level deep and never under themselves', () => {
    expect(divisionProblems({ ...divisionDraft(null), parentId: 'k2' }, ctx)).toEqual(['PARENT']);
    expect(divisionProblems({ ...divisionDraft(null), parentId: 'k1' }, { ...ctx, categoryId: 'k1' })).toEqual(['PARENT']);
    expect(divisionProblems({ ...divisionDraft(null), parentId: 'k1' }, ctx)).toEqual([]);
  });

  it('needs a 6-digit code to lock a division', () => {
    expect(divisionProblems({ ...divisionDraft(null), locked: true }, ctx)).toEqual(['CODE']);
    expect(divisionProblems({ ...divisionDraft(null), locked: true, unlockCode: '123456' }, ctx)).toEqual([]);
  });

  it('wants an early-bird price below the base price, ending before registration closes', () => {
    const early = { ...divisionDraft(null), earlyPrice: '30', earlyUntil: new Date('2026-11-01T00:00:00.000Z') };
    expect(divisionProblems(early, ctx)).toEqual([]);
    expect(divisionProblems({ ...early, earlyPrice: '45' }, ctx)).toEqual(['EARLY_PRICE']);
    expect(divisionProblems({ ...early, earlyUntil: null }, ctx)).toEqual(['EARLY_DATE']);
    expect(divisionProblems({ ...early, earlyUntil: new Date('2026-12-05T00:00:00.000Z') }, ctx)).toEqual(['EARLY_DATE']);
  });

  it('saves millimes and dates, and no team size for individuals', () => {
    const body = divisionBody({ ...divisionDraft(null), earlyPrice: '30', earlyUntil: new Date('2026-11-01T00:00:00.000Z'), teamMale: '2' });
    expect(body).toMatchObject({ type: 'INDIVIDUAL', teamMale: null, teamFemale: null, earlyPrice: 30000, earlyUntil: '2026-11-01T00:00:00.000Z', locked: false, unlockCode: null });
    expect(divisionBody({ ...divisionDraft(null), type: 'TEAM', teamMale: '2', teamFemale: '2' })).toMatchObject({ type: 'TEAM', teamMale: 2, teamFemale: 2 });
  });

  it('counts a team and groups sub-divisions under their parent', () => {
    expect(teamSize({ teamMale: 2, teamFemale: 1 })).toBe(3);
    const tree = divisionTree([
      { id: 'k1', sortOrder: 0 },
      { id: 'k3', sortOrder: 2, parentId: 'k1' },
      { id: 'k2', sortOrder: 1, parentId: 'k1' },
      { id: 'k4', sortOrder: 3 },
    ]);
    expect(tree.map((n) => [n.parent.id, n.children.map((x) => x.id)])).toEqual([
      ['k1', ['k2', 'k3']],
      ['k4', []],
    ]);
  });
});

describe('pricing (fees, tax, deposits)', () => {
  const base = pricingOf({});

  it('passes the platform fee (4 % + 1.5 TND) to the athlete by default', () => {
    expect(priceBreakdown({ price: 40000 }, base)).toMatchObject({ net: 40000, tax: 0, fee: 3100, athletePays: 43100, organizerGets: 40000, depositNow: 43100, balance: 0 });
  });

  it('absorbs or splits the fee', () => {
    expect(priceBreakdown({ price: 40000 }, { ...base, fee: 'ABSORB' })).toMatchObject({ athletePays: 40000, organizerGets: 36900 });
    expect(priceBreakdown({ price: 40000 }, { ...base, fee: 'SPLIT' })).toMatchObject({ athletePays: 41550, organizerGets: 38450 });
  });

  it('adds VAT on top or takes it out of the price', () => {
    expect(priceBreakdown({ price: 40000 }, { ...base, tax: { ...base.tax, enabled: true, percent: 19, mode: 'ADDED' } })).toMatchObject({ tax: 7600, subtotal: 47600, fee: 3404, athletePays: 51004 });
    expect(priceBreakdown({ price: 40000 }, { ...base, tax: { ...base.tax, enabled: true, percent: 19, mode: 'INCLUDED' } })).toMatchObject({ tax: 6387, subtotal: 40000, fee: 3100 });
  });

  it('takes the promo code off before tax and fee, and charges nothing for a free event', () => {
    expect(priceBreakdown({ price: 40000, discount: 10000 }, base)).toMatchObject({ net: 30000, fee: 2700, athletePays: 32700 });
    expect(priceBreakdown({ price: 0 }, base)).toMatchObject({ fee: 0, athletePays: 0 });
  });

  it('splits a deposit from the balance, as a percentage or a fixed amount', () => {
    expect(priceBreakdown({ price: 40000 }, { ...base, deposit: { ...base.deposit, enabled: true, type: 'PERCENT', value: 30 } })).toMatchObject({ depositNow: 12930, balance: 30170 });
    expect(priceBreakdown({ price: 40000 }, { ...base, deposit: { ...base.deposit, enabled: true, type: 'FIXED', value: 10000 } })).toMatchObject({ depositNow: 10000, balance: 33100 });
  });

  it('uses the early-bird price until its date, and the category price over the event price', () => {
    const c = { registrationPrice: 40000 };
    const cat = { registrationPriceOverride: 35000, earlyPrice: 30000, earlyUntil: '2026-11-01T00:00:00.000Z' };
    expect(effectivePrice(c, cat, new Date('2026-10-22T00:00:00.000Z'))).toBe(30000);
    expect(effectivePrice(c, cat, new Date('2026-11-02T00:00:00.000Z'))).toBe(35000);
    expect(effectivePrice(c, null, new Date('2026-11-02T00:00:00.000Z'))).toBe(40000);
  });

  it('checks the form and saves numbers', () => {
    const d = { ...pricingDraft({}), taxEnabled: true, taxPercent: '120', depositEnabled: true, depositType: 'PERCENT' as const, depositValue: '0' };
    expect(pricingProblems(d)).toEqual(['TAX_PERCENT', 'DEPOSIT_VALUE']);
    const ok = { ...d, taxPercent: '19', depositType: 'FIXED' as const, depositValue: '10' };
    expect(pricingProblems(ok)).toEqual([]);
    expect(pricingBody(ok)).toMatchObject({ tax: { enabled: true, percent: 19 }, deposit: { enabled: true, type: 'FIXED', value: 10000 } });
    expect(pricingDraft({ pricing: pricingBody(ok) })).toMatchObject({ taxPercent: '19', depositValue: '10' });
  });
});

describe('registration form and agreements', () => {
  it('starts with no extra field and every agreement off', () => {
    expect(formOf({})).toEqual([]);
    expect(agreementsOf({})).toMatchObject({ liability: { required: false }, minors: { enabled: false, age: 18 }, medicalReport: { required: false } });
  });

  it('needs a label, and at least two options for a list', () => {
    expect(fieldProblems({ id: 'f1', label: ' ', type: 'TEXT', required: true, options: [] })).toEqual(['LABEL']);
    expect(fieldProblems({ id: 'f1', label: 'Shirt', type: 'SELECT', required: true, options: ['S'] })).toEqual(['OPTIONS']);
    expect(fieldProblems({ id: 'f1', label: 'Shirt', type: 'SIZE', required: true, options: [] })).toEqual([]);
  });

  it('moves a field up or down', () => {
    const f = (id: string) => ({ id, label: id, type: 'TEXT' as const, required: false, options: [] });
    expect(moveField([f('a'), f('b'), f('c')], 2, -1).map((x) => x.id)).toEqual(['a', 'c', 'b']);
    expect(moveField([f('a'), f('b')], 0, -1).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('asks for the text of every required agreement', () => {
    const a = agreementsOf({});
    expect(agreementProblems({ ...a, liability: { required: true, text: '' }, custom: { required: true, title: 'Photos', text: '' }, minors: { ...a.minors, enabled: true, age: 30 } })).toEqual(['LIABILITY_TEXT', 'CUSTOM_TEXT', 'MINOR_AGE']);
  });

  it('lists the required answers an athlete left empty or got wrong', () => {
    const fields = [
      { id: 'tshirt', label: 'T-shirt', type: 'SIZE' as const, required: true, options: [] },
      { id: 'box', label: 'Box', type: 'TEXT' as const, required: false, options: [] },
      { id: 'age', label: 'Years of training', type: 'NUMBER' as const, required: true, options: [] },
    ];
    expect(answerProblems(fields, { tshirt: '', age: 'ten' })).toEqual(['tshirt', 'age']);
    expect(answerProblems(fields, { tshirt: 'M', age: '4' })).toEqual([]);
  });
});
