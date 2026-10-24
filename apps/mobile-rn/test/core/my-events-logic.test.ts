import { dueOf, isPast, registrationState, requiredActions, rolesOf, sortMine, staffRoleOf } from '../../src/features/competitions/logic-my-events';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const at = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

describe('my events', () => {
  it('finds my roles in an event', () => {
    expect(rolesOf({ myRegistration: { registrationStatus: 'CONFIRMED' }, myRoles: [] })).toEqual(['ATHLETE']);
    expect(rolesOf({ myRegistration: { registrationStatus: 'CANCELLED' }, myRoles: ['ORGANIZER'] })).toEqual(['ORGANIZER']);
    expect(rolesOf({ myRegistration: null, myRoles: ['FLOOR_JUDGE'] })).toEqual(['STAFF']);
    expect(staffRoleOf({ myRoles: ['FLOOR_JUDGE', 'HEAD_JUDGE'] })).toBe('HEAD_JUDGE');
  });

  it('upcoming first by date, then past events, the latest first', () => {
    const list = [
      { id: 'old', eventStart: at(-60), eventEnd: at(-59) },
      { id: 'later', eventStart: at(40) },
      { id: 'recent', eventStart: at(-10), eventEnd: at(-9) },
      { id: 'soon', eventStart: at(5) },
    ];
    expect(sortMine(list, NOW).map((c) => c.id)).toEqual(['soon', 'later', 'recent', 'old']);
    expect(isPast(list[0], NOW)).toBe(true);
  });

  it('says « 3 days left », « due today » or « deadline passed »', () => {
    expect(dueOf(at(3.5), NOW)).toEqual({ kind: 'DAYS', days: 3 });
    expect(dueOf(at(0.2), NOW)).toEqual({ kind: 'TODAY' });
    expect(dueOf(at(-1), NOW)).toEqual({ kind: 'PASSED' });
    expect(dueOf(null, NOW)).toEqual({ kind: 'NONE' });
  });

  it('lists what is left: payment, the balance of a deposit, and the scores of an online event', () => {
    const base = { eventStart: at(10), format: 'ONLINE', workouts: [{}, {}, {}, {}], deadlines: { registrationEnd: at(3.5), scoreSubmissionDeadline: at(8.5) } };
    expect(requiredActions({ ...base, myRegistration: { registrationStatus: 'PENDING', paymentStatus: 'PENDING' } }, 0, NOW)).toEqual([{ kind: 'PAYMENT', due: { kind: 'DAYS', days: 3 } }]);
    expect(requiredActions({ ...base, myRegistration: { registrationStatus: 'PENDING', paymentStatus: 'PENDING', paymentPlan: 'DEPOSIT' } }, 0, NOW)[0].kind).toBe('BALANCE');
    expect(requiredActions({ ...base, myRegistration: { registrationStatus: 'CONFIRMED', paymentStatus: 'PAID' } }, 2, NOW)).toEqual([{ kind: 'SCORES', sent: 2, total: 4, due: { kind: 'DAYS', days: 8 } }]);
    expect(requiredActions({ ...base, myRegistration: { registrationStatus: 'CONFIRMED', paymentStatus: 'PAID' } }, 4, NOW)).toEqual([]);
    expect(requiredActions({ ...base, format: 'ONSITE', myRegistration: { registrationStatus: 'CONFIRMED', paymentStatus: 'FREE' } }, 0, NOW)).toEqual([]);
    expect(requiredActions({ ...base, eventStart: at(-3), eventEnd: at(-2), myRegistration: { registrationStatus: 'PENDING', paymentStatus: 'PENDING' } }, 0, NOW)).toEqual([]);
  });

  it('the status of my registration', () => {
    expect(registrationState({ myRegistration: { registrationStatus: 'CONFIRMED' } })).toBe('CONFIRMED');
    expect(registrationState({ myRegistration: { registrationStatus: 'PENDING', paymentStatus: 'PENDING' } })).toBe('PAYMENT_PENDING');
  });
});
