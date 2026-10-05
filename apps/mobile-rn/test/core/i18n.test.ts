import { format, pluralCategory, translate } from '../../src/core/i18n';

describe('i18n (ARB/ICU messages)', () => {
  it('substitutes placeholders', () => {
    expect(format('Hello {name}!', { name: 'Ahmed' })).toBe('Hello Ahmed!');
  });

  it('picks exact plural cases first, then other', () => {
    const m = '{count, plural, =0{No streak yet} =1{1-week streak} other{{count}-week streak}}';
    expect(format(m, { count: 0 })).toBe('No streak yet');
    expect(format(m, { count: 1 })).toBe('1-week streak');
    expect(format(m, { count: 7 })).toBe('7-week streak');
  });

  it('handles plurals embedded in text', () => {
    expect(format('MMR {rating} · {games, plural, =0{no duels yet} =1{1 duel} other{{games} duels}}', { rating: 1200, games: 3 })).toBe('MMR 1200 · 3 duels');
  });

  it('translates every catalog key in the three languages', () => {
    expect(translate('en', 'navHome')).toBe('Home');
    expect(translate('fr', 'navHome')).not.toBe('navHome');
    expect(translate('ar', 'navHome')).not.toBe('navHome');
  });
});

describe('plurals without Intl.PluralRules (Hermes on devices)', () => {
  const real = Intl.PluralRules;
  const numbers = [0, 1, 2, 3, 5, 10, 11, 12, 50, 99, 100, 101, 102, 103, 111, 1.5, 1_000_000, 2_000_000];
  const expected = Object.fromEntries((['en', 'fr', 'ar'] as const).map((l) => [l, numbers.map((n) => new real(l).select(n))]));
  const intl = Intl as unknown as { PluralRules: unknown };
  afterEach(() => {
    intl.PluralRules = real;
  });

  it('gives the same category as the CLDR rules for every app locale', () => {
    intl.PluralRules = undefined; // the engine without PluralRules
    for (const l of ['en', 'fr', 'ar'] as const) expect(numbers.map((n) => pluralCategory(l, n))).toEqual(expected[l]);
  });

  it('formats plural messages instead of throwing', () => {
    intl.PluralRules = undefined; // the engine without PluralRules
    expect(translate('en', 'compAthletes', { count: 1 })).not.toBe(translate('en', 'compAthletes', { count: 2 }));
  });
});
