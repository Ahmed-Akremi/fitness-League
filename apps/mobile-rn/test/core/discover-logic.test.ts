import { activeFilters, countriesOf, daysToRegister, EMPTY_DISCOVER, filterEvents, flagOf, matches, toggle, typeOf } from '../../src/features/competitions/logic-discover';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const ev = (id: string, extra: object = {}) => ({ id, title: `Event ${id}`, city: 'Tunis', countryCode: 'TN', format: 'ONSITE', status: 'REGISTRATION_OPEN', eventStart: '2026-11-10T08:00:00Z', eventEnd: '2026-11-11T18:00:00Z', registrationEnd: '2026-11-01T22:00:00Z', ...extra });

describe('event discovery', () => {
  const list = [
    ev('a', { title: 'Soussé Throwdown', city: 'Sousse' }),
    ev('b', { eventStyle: 'HYBRID_RACE', format: 'ONLINE', countryCode: 'FR', eventStart: '2027-03-01T08:00:00Z', eventEnd: '2027-03-01T18:00:00Z' }),
    ev('c', { countryCode: 'tn', format: 'HYBRID', eventStart: '2026-10-20T08:00:00Z', eventEnd: '2026-10-30T18:00:00Z' }),
  ];

  it('searches title, city and place, accents and case aside', () => {
    expect(filterEvents(list, { ...EMPTY_DISCOVER, q: 'sousse' }, NOW).map((c) => c.id)).toEqual(['a']);
    expect(filterEvents(list, { ...EMPTY_DISCOVER, q: '  ' }, NOW)).toHaveLength(3);
  });

  it('filters by type, format and country (any of the chosen values)', () => {
    expect(typeOf(list[1])).toBe('HYBRID');
    expect(filterEvents(list, { ...EMPTY_DISCOVER, types: ['HYBRID'] }, NOW).map((c) => c.id)).toEqual(['b']);
    expect(filterEvents(list, { ...EMPTY_DISCOVER, formats: ['ONSITE', 'HYBRID'] }, NOW).map((c) => c.id)).toEqual(['a', 'c']);
    expect(filterEvents(list, { ...EMPTY_DISCOVER, countries: ['TN'] }, NOW).map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('« this month » keeps events starting within 31 days and those running now', () => {
    expect(filterEvents(list, { ...EMPTY_DISCOVER, when: 'MONTH' }, NOW).map((c) => c.id)).toEqual(['a', 'c']);
    expect(filterEvents(list, { ...EMPTY_DISCOVER, when: 'QUARTER' }, NOW).map((c) => c.id)).toEqual(['a', 'c']);
    expect(matches(ev('old', { eventStart: '2026-09-01T08:00:00Z', eventEnd: '2026-09-02T08:00:00Z' }), { ...EMPTY_DISCOVER, when: 'MONTH' }, NOW)).toBe(false);
  });

  it('counts the active filters and lists the countries, most events first', () => {
    expect(activeFilters({ ...EMPTY_DISCOVER, q: 'x', types: ['HYBRID'], countries: ['TN', 'FR'], when: 'MONTH' })).toBe(4);
    expect(countriesOf(list)).toEqual(['TN', 'FR']);
    expect(toggle(['A'], 'B')).toEqual(['A', 'B']);
    expect(toggle(['A', 'B'], 'A')).toEqual(['B']);
  });

  it('days left to register, and the flag of a country', () => {
    expect(daysToRegister(ev('x'), NOW)).toBe(8);
    expect(daysToRegister(ev('x', { status: 'REGISTRATION_CLOSED' }), NOW)).toBeNull();
    expect(daysToRegister(ev('x', { registrationEnd: '2026-10-24T20:00:00Z' }), NOW)).toBe(0);
    expect(daysToRegister(ev('x', { registrationEnd: '2026-10-01T20:00:00Z' }), NOW)).toBeNull();
    expect(flagOf('tn')).toBe('🇹🇳');
    expect(flagOf('Tunisia')).toBe('');
  });
});
