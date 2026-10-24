import { appealRuleOf, appealState, myRow, reasonOk, searchBoard } from '../../src/features/competitions/logic-board';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const rows = [
  { rank: 1, athlete: { id: 'u1', fullName: 'Hédi Kéfi', username: 'hedi' } },
  { rank: 2, athlete: { id: 'u2', fullName: 'Sami Ben Ali', username: 'sami_rx' } },
];

describe('athlete leaderboard', () => {
  it('searches a participant by name or username, accents aside, and finds my row', () => {
    expect(searchBoard(rows, 'hedi').map((r) => r.rank)).toEqual([1]);
    expect(searchBoard(rows, 'SAMI_RX').map((r) => r.rank)).toEqual([2]);
    expect(searchBoard(rows, '  ')).toHaveLength(2);
    expect(myRow(rows, 'u2')?.rank).toBe(2);
    expect(myRow(rows, null)).toBeNull();
  });
});

describe('appeals', () => {
  const on = appealRuleOf({ settings: { appeals: { enabled: true, price: 5000, maxPerAthlete: 2, deadline: '2026-10-30T00:00:00Z' } } });
  it('reads the organizer’s rule', () => {
    expect(on).toEqual({ enabled: true, price: 5000, maxPerAthlete: 2, deadline: '2026-10-30T00:00:00Z' });
    expect(appealRuleOf({}).enabled).toBe(false);
  });

  it('opens only for a judged score, before the deadline, when appeals are on', () => {
    expect(appealState(on, { status: 'FINAL' }, NOW)).toBe('OPEN');
    expect(appealState(on, { status: 'SUBMITTED' }, NOW)).toBe('NO_SCORE');
    expect(appealState(on, undefined, NOW)).toBe('NO_SCORE');
    expect(appealState(on, { status: 'FINAL' }, Date.parse('2026-11-01T00:00:00Z'))).toBe('EXPIRED');
    expect(appealState(appealRuleOf({}), { status: 'FINAL' }, NOW)).toBe('OFF');
    expect(reasonOk('too short')).toBe(false);
    expect(reasonOk('The judge missed my last three reps on video.')).toBe(true);
  });
});
