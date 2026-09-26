import { ageBracket, ageInYears, lockDurationMinutes } from './auth-policy';

describe('lockDurationMinutes', () => {
  it('does not lock before the 5th failure', () => {
    expect([1, 2, 3, 4].map(lockDurationMinutes)).toEqual([null, null, null, null]);
  });

  it('locks on every 5th failure, doubling up to 24 h', () => {
    expect(lockDurationMinutes(5)).toBe(15);
    expect(lockDurationMinutes(6)).toBeNull();
    expect(lockDurationMinutes(10)).toBe(30);
    expect(lockDurationMinutes(15)).toBe(60);
    expect(lockDurationMinutes(5 * 20)).toBe(1440);
  });
});

describe('ageInYears', () => {
  it('counts full years only', () => {
    expect(ageInYears('2008-09-26', '2026-09-26')).toBe(18);
    expect(ageInYears('2008-09-27', '2026-09-26')).toBe(17);
    expect(ageInYears('2008-10-01', '2026-09-26')).toBe(17);
  });

  it('handles 29 February birthdays', () => {
    expect(ageInYears('2008-02-29', '2026-02-28')).toBe(17);
    expect(ageInYears('2008-02-29', '2026-03-01')).toBe(18);
  });
});

describe('ageBracket', () => {
  it('maps ages to public brackets', () => {
    expect([17, 18, 24, 25, 34, 35].map(ageBracket)).toEqual([null, '18-24', '18-24', '25-34', '25-34', '35+']);
  });
});
