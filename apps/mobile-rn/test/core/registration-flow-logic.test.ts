import {
  codeMatches,
  inviteRefused,
  minorProblems,
  needsEventCode,
  queueStart,
  queueTick,
  registrationExtras,
  requiredAgreements,
  teamMemberSlots,
  teamProblems,
} from '../../src/features/competitions/logic-registration';
import { agreementsOf } from '../../src/features/competitions/organizer/logic-forms';

describe('registration gates', () => {
  it('refuses an email that is not on the invitation list of an invite-only event', () => {
    const c = { inviteOnly: true, settings: { invitedEmails: ['a@x.tn'] } };
    expect(inviteRefused(c, 'A@X.tn')).toBe(false);
    expect(inviteRefused(c, 'b@x.tn')).toBe(true);
    expect(inviteRefused({ settings: { restrictToEmailList: true, invitedEmails: [] } }, 'a@x.tn')).toBe(true);
    expect(inviteRefused({}, 'b@x.tn')).toBe(false);
  });

  it('asks for the code of a password-protected event only', () => {
    expect(needsEventCode({ visibility: 'PASSWORD', accessCode: '123456' })).toBe(true);
    expect(needsEventCode({ visibility: 'PUBLIC', accessCode: '123456' })).toBe(false);
    expect(codeMatches(' 123456 ', '123456')).toBe(true);
    expect(codeMatches('123457', '123456')).toBe(false);
  });
});

describe('teams', () => {
  const team = { type: 'TEAM', teamMale: 2, teamFemale: 2 };

  it('asks for the other members: the captain is the athlete registering', () => {
    expect(teamMemberSlots(team)).toBe(3);
    expect(teamMemberSlots({ type: 'INDIVIDUAL' })).toBe(0);
  });

  it('needs a team name and every member email, all different', () => {
    expect(teamProblems(team, 'B', ['a@x.tn', 'b@x.tn', 'c@x.tn'])).toEqual(['TEAM_NAME']);
    expect(teamProblems(team, 'Box Bandits', ['a@x.tn', 'a@x.tn', 'c@x.tn'])).toEqual(['MEMBERS']);
    expect(teamProblems(team, 'Box Bandits', ['a@x.tn', 'b@x.tn', ''])).toEqual(['MEMBERS']);
    expect(teamProblems(team, 'Box Bandits', ['a@x.tn', 'b@x.tn', 'c@x.tn'])).toEqual([]);
  });
});

describe('queue (simulated waiting room of a busy event)', () => {
  it('starts with a few athletes ahead and lets the athlete in when the line is through', () => {
    let s = queueStart(2);
    expect(s).toEqual({ phase: 'WAITING', position: 5 });
    while (s.phase === 'WAITING') s = queueTick(s);
    expect(s).toEqual({ phase: 'ADMITTED', position: 0 });
  });
});

describe('minors and agreements', () => {
  const a = { ...agreementsOf({}), liability: { required: true, text: 'Own risk.' }, minors: { enabled: true, age: 18, photoConsent: true } };

  it('lists the agreements the athlete must accept', () => {
    expect(requiredAgreements(a)).toEqual(['LIABILITY']);
    expect(requiredAgreements({ ...a, custom: { required: true, title: 'Photos', text: 'OK' }, medicalReport: { required: true, description: '' } })).toEqual(['LIABILITY', 'CUSTOM', 'MEDICAL']);
  });

  it('needs the guardian name, email, phone and consent for a minor', () => {
    expect(minorProblems({ name: '', email: 'mum@', phone: '1', consent: false })).toEqual(['GUARDIAN_NAME', 'GUARDIAN_EMAIL', 'GUARDIAN_PHONE', 'GUARDIAN_CONSENT']);
    expect(minorProblems({ name: 'Leila', email: 'leila@x.tn', phone: '+216 20 000 000', consent: true })).toEqual([]);
  });
});

describe('what the registration keeps', () => {
  it('keeps only what applies, trimmed and lower-cased', () => {
    expect(
      registrationExtras({
        answers: { tshirt: 'M' },
        accepted: ['LIABILITY'],
        teamName: '  Box Bandits ',
        teamMembers: ['A@x.tn'],
        giftFor: '',
        plan: 'DEPOSIT',
        guardian: null,
      }),
    ).toEqual({ answers: { tshirt: 'M' }, agreementsAccepted: ['LIABILITY'], teamName: 'Box Bandits', teamMembers: ['a@x.tn'], paymentPlan: 'DEPOSIT' });
  });
});
