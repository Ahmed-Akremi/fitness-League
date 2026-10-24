import { registrationSteps } from '../../src/features/competitions/register';
import { ageRange, cheapestPrice, earlyBirdPercent, registrationLine, whoCanJoin, workoutFormat } from '../../src/features/competitions/logic-event-page';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const NEXT_WEEK = '2026-10-31T12:00:00Z';

describe('event page facts', () => {
  const c = {
    registrationPrice: 40000,
    categories: [
      { id: 'a', price: 40000, earlyPrice: 30000, earlyUntil: NEXT_WEEK },
      { id: 'b', price: 35000 },
      { id: 'c', price: 10000, active: false },
      { id: 'd', price: 50000, earlyPrice: 45000, earlyUntil: '2026-10-01T00:00:00Z' },
    ],
  };

  it('the cheapest entry counts a running early bird, not an ended one nor an inactive division', () => {
    expect(cheapestPrice(c, NOW)).toBe(30000);
    expect(cheapestPrice({ registrationPrice: 2500, categories: [] }, NOW)).toBe(2500);
  });

  it('the biggest early-bird saving still running', () => {
    expect(earlyBirdPercent(c, NOW)).toBe(25);
    expect(earlyBirdPercent(c, Date.parse('2026-11-05T00:00:00Z'))).toBeNull();
  });

  it('the registration line: open with the days left, starting later, or closed', () => {
    expect(registrationLine({ status: 'REGISTRATION_OPEN', deadlines: { registrationEnd: '2026-10-27T13:00:00Z' } }, NOW)).toEqual({ kind: 'OPEN', until: '2026-10-27T13:00:00Z', daysLeft: 3 });
    expect(registrationLine({ status: 'UPCOMING', deadlines: { registrationStart: NEXT_WEEK } }, NOW)).toEqual({ kind: 'STARTS', from: NEXT_WEEK });
    expect(registrationLine({ status: 'ACTIVE' }, NOW)).toEqual({ kind: 'CLOSED' });
  });

  it('who can join, the workout format and the ages', () => {
    expect(whoCanJoin({ categories: [{ type: 'TEAM' }, { type: 'INDIVIDUAL' }] })).toEqual({ individuals: true, teams: true });
    expect(whoCanJoin({ categories: [{ type: 'TEAM' }] })).toEqual({ individuals: false, teams: true });
    expect(whoCanJoin({ categories: [] })).toEqual({ individuals: true, teams: false });
    expect(workoutFormat('TIME')).toBe('FOR_TIME');
    expect(workoutFormat('ROUNDS_REPS')).toBe('AMRAP');
    expect(workoutFormat('MAX_WEIGHT')).toBe('MAX');
    expect(workoutFormat('POINTS')).toBe('POINTS');
    expect(ageRange({ minAge: 18, maxAge: 35 })).toBe('18–35');
    expect(ageRange({ minAge: 40 })).toBe('40+');
    expect(ageRange({})).toBe('');
  });
});

describe('registration steps', () => {
  it('asks only for what the organizer set up', () => {
    expect(registrationSteps(false, false)).toEqual(['DIVISION', 'PAYMENT']);
    expect(registrationSteps(true, true)).toEqual(['DIVISION', 'DETAILS', 'AGREEMENTS', 'PAYMENT']);
    expect(registrationSteps(false, true)).toEqual(['DIVISION', 'AGREEMENTS', 'PAYMENT']);
  });
});
