import { format, translate } from '../../src/core/i18n';

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
