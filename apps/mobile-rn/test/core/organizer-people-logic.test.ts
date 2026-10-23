import { applicationProblems, checkinStats, finalistsFrom, parseLines, staffFilter, staffStats } from '../../src/features/competitions/organizer/logic-people';

describe('check-in', () => {
  const cats = [
    { id: 'k1', name: 'RX Men' },
    { id: 'k2', name: 'RX Women' },
  ];
  const regs = [
    { id: 'r1', categoryId: 'k1', registrationStatus: 'CONFIRMED' },
    { id: 'r2', categoryId: 'k1', registrationStatus: 'PENDING' },
    { id: 'r3', categoryId: 'k2', registrationStatus: 'CONFIRMED' },
    { id: 'r4', categoryId: 'k2', registrationStatus: 'CANCELLED' },
  ];

  it('counts checked-in athletes per division, cancelled registrations left out', () => {
    expect(checkinStats(regs, [{ id: 'r1' }, { id: 'r4' }], cats)).toEqual({
      total: 3,
      checked: 1,
      byCategory: [
        { categoryId: 'k1', name: 'RX Men', total: 2, checked: 1 },
        { categoryId: 'k2', name: 'RX Women', total: 1, checked: 0 },
      ],
    });
  });
});

describe('finalists', () => {
  it('invites the top N of a qualifier division', () => {
    const rows = [
      { rank: 2, athlete: { id: 'u2', fullName: 'Karim' }, totalPoints: 150 },
      { rank: 1, athlete: { id: 'u1', fullName: 'Hédi' }, totalPoints: 180 },
      { rank: 3, athlete: { id: 'u3', fullName: 'Omar' }, totalPoints: 120 },
    ];
    expect(finalistsFrom(rows, 2, 'k1')).toEqual([
      { id: 'k1:u1', categoryId: 'k1', userId: 'u1', name: 'Hédi', rank: 1, status: 'INVITED' },
      { id: 'k1:u2', categoryId: 'k1', userId: 'u2', name: 'Karim', rank: 2, status: 'INVITED' },
    ]);
  });
});

describe('staff', () => {
  const apps = [
    { id: 'a1', role: 'Judge', status: 'APPROVED', checkedIn: true },
    { id: 'a2', role: 'Judge', status: 'PENDING', checkedIn: false },
    { id: 'a3', role: 'Volunteer', status: 'DECLINED', checkedIn: false },
  ];

  it('reads one role or shift per line, without duplicates', () => {
    expect(parseLines('Judge\n Volunteer \n\nJudge')).toEqual(['Judge', 'Volunteer']);
  });

  it('filters applications by role and status', () => {
    expect(staffFilter(apps, { role: 'Judge', status: null }).map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(staffFilter(apps, { role: null, status: 'DECLINED' }).map((a) => a.id)).toEqual(['a3']);
  });

  it('counts applicants, approved, pending, declined and checked in', () => {
    expect(staffStats(apps)).toEqual({ total: 3, approved: 1, pending: 1, declined: 1, checkedIn: 1 });
  });

  it('needs a name, a valid email and one of the form roles', () => {
    const form = { roles: ['Judge', 'Volunteer'] };
    expect(applicationProblems({ name: 'S', email: 'sami@', role: 'Coach' }, form)).toEqual(['NAME', 'EMAIL', 'ROLE']);
    expect(applicationProblems({ name: 'Sami', email: 'sami@x.tn', role: 'Judge' }, form)).toEqual([]);
  });
});
