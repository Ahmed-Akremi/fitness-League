import { invitationOpens, membersChanged, myInvitation, oneStaysOk, teamRules } from '../../src/features/competitions/logic-team';

const NOW = Date.parse('2026-10-24T12:00:00Z');

describe('team changes', () => {
  const c = (k: object) => ({ eventStart: '2026-12-12T08:00:00Z', myRegistration: { categoryId: 'k1' }, categories: [{ id: 'k1', type: 'TEAM', ...k }] });

  it('opens each change until the division’s date, or until the event starts', () => {
    const r = teamRules(c({ teamNameChangeUntil: '2026-10-20T00:00:00Z', memberChangeUntil: '2026-11-01T00:00:00Z', memberChangePrice: 10000, oneMemberStays: true }), NOW);
    expect(r.name).toEqual({ allowed: false, until: '2026-10-20T00:00:00Z' });
    expect(r.members).toEqual({ allowed: true, until: '2026-11-01T00:00:00Z' });
    expect(r.fee).toBe(10000);
    expect(r.oneStays).toBe(true);
    expect(teamRules(c({}), NOW).name).toEqual({ allowed: true, until: '2026-12-12T08:00:00Z' });
  });

  it('counts who left, and keeps one member when the organizer asks', () => {
    expect(membersChanged(['a@x.tn', 'b@x.tn'], ['A@x.tn', 'c@x.tn'])).toBe(1);
    expect(oneStaysOk(['a@x.tn', 'b@x.tn'], ['c@x.tn', 'd@x.tn'])).toBe(false);
    expect(oneStaysOk(['a@x.tn', 'b@x.tn'], ['a@x.tn', 'd@x.tn'])).toBe(true);
    expect(oneStaysOk([], ['d@x.tn'])).toBe(true);
  });
});

describe('finals invitation', () => {
  const list = [{ id: 'k1:u1', userId: 'u1', status: 'INVITED' }, { id: 'k1:u2', userId: 'u2', status: 'DECLINED' }];
  it('finds my invitation and whether it opens the registration', () => {
    expect(myInvitation(list, 'u1')?.id).toBe('k1:u1');
    expect(myInvitation(list, 'u9')).toBeNull();
    expect(invitationOpens(myInvitation(list, 'u1'))).toBe(true);
    expect(invitationOpens(myInvitation(list, 'u2'))).toBe(false);
    expect(invitationOpens(null)).toBe(false);
  });
});
