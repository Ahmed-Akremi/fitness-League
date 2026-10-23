import {
  accessCodeFrom,
  copyCategoryBodies,
  copyWodBodies,
  detailsBody,
  detailsErrors,
  detailsOf,
  parseEmails,
  settingsBody,
  settingsDraft,
  settingsProblems,
  setupBody,
  setupOf,
  setupValid,
  styleLocked,
} from '../../src/features/competitions/organizer/logic-event';

describe('event setup (type, visibility, participants, label)', () => {
  it('gives an event made before the setup existed the defaults', () => {
    expect(setupOf({})).toEqual({
      eventStyle: 'FUNCTIONAL_FITNESS',
      hybridTemplate: null,
      visibility: 'PUBLIC',
      accessCode: null,
      participantTypes: ['INDIVIDUAL'],
      label: 'NONE',
      inviteOnly: false,
    });
  });

  it('reads a saved setup back', () => {
    const c = { eventStyle: 'HYBRID_RACE', hybridTemplate: 'HYROX_STYLE', visibility: 'PASSWORD', accessCode: '042917', participantTypes: ['TEAM'], label: 'FINAL', inviteOnly: true };
    expect(setupOf(c)).toEqual(c);
  });

  it('needs a template for a hybrid race', () => {
    expect(setupValid({ ...setupOf({}), eventStyle: 'HYBRID_RACE' })).toBe(false);
    expect(setupValid({ ...setupOf({}), eventStyle: 'HYBRID_RACE', hybridTemplate: 'CUSTOM' })).toBe(true);
  });

  it('needs a 6-digit code for a password-protected event', () => {
    expect(setupValid({ ...setupOf({}), visibility: 'PASSWORD' })).toBe(false);
    expect(setupValid({ ...setupOf({}), visibility: 'PASSWORD', accessCode: '12345' })).toBe(false);
    expect(setupValid({ ...setupOf({}), visibility: 'PASSWORD', accessCode: '123456' })).toBe(true);
  });

  it('needs individuals, teams or both', () => {
    expect(setupValid({ ...setupOf({}), participantTypes: [] })).toBe(false);
  });

  it('sends the template only for a hybrid race and the code only for a password', () => {
    const body = setupBody({ ...setupOf({}), hybridTemplate: 'CUSTOM', accessCode: '123456' });
    expect(body).toMatchObject({ eventStyle: 'FUNCTIONAL_FITNESS', hybridTemplate: null, visibility: 'PUBLIC', accessCode: null });
  });

  it('makes a 6-digit code from random bytes', () => {
    expect(accessCodeFrom(new Uint8Array([0, 0, 0, 7]))).toBe('000007');
    expect(accessCodeFrom(new Uint8Array([255, 255, 255, 255]))).toMatch(/^\d{6}$/);
  });

  it('locks the event type once the event has a WOD', () => {
    expect(styleLocked({ workouts: [] })).toBe(false);
    expect(styleLocked({ workouts: [{ id: 'w1' }] })).toBe(true);
  });
});

describe('contact and links', () => {
  it('reads empty fields for an event without them', () => {
    expect(detailsOf({})).toEqual({ organizerName: '', contactEmail: '', website: '', instagram: '', facebook: '', videoUrl: '', rulebookUrl: '' });
  });

  it('flags a wrong email, a link without https and a video that is not YouTube or Vimeo', () => {
    const d = { ...detailsOf({}), contactEmail: 'coach@', website: 'example.com', videoUrl: 'https://example.com/v.mp4', rulebookUrl: 'https://example.com/rules.pdf' };
    expect(detailsErrors(d)).toEqual({ contactEmail: 'EMAIL', website: 'URL', videoUrl: 'VIDEO' });
  });

  it('accepts empty optional fields and YouTube or Vimeo videos', () => {
    expect(detailsErrors({ ...detailsOf({}), videoUrl: 'https://youtu.be/dQw4w9WgXcQ' })).toEqual({});
    expect(detailsErrors({ ...detailsOf({}), videoUrl: 'https://vimeo.com/76979871' })).toEqual({});
  });

  it('sends trimmed values and drops the « @ » of social accounts', () => {
    expect(detailsBody({ ...detailsOf({}), contactEmail: ' hello@box.tn ', instagram: '@box.tn' })).toMatchObject({ contactEmail: 'hello@box.tn', instagram: 'box.tn' });
  });
});

describe('settings', () => {
  it('splits an email list on lines and commas, lower-cases it and keeps the bad ones apart', () => {
    expect(parseEmails('A@x.tn, b@y.tn\nnot-an-email\n\nb@y.tn')).toEqual({ emails: ['a@x.tn', 'b@y.tn'], invalid: ['not-an-email'] });
  });

  it('gives an event without settings the defaults', () => {
    expect(settingsDraft({})).toMatchObject({ countVisibility: 'SHOW', maxIndividuals: '', maxTeams: '', restrictToEmailList: false, appealsEnabled: false, neutral: '' });
  });

  it('lists what is wrong before saving', () => {
    const d = { ...settingsDraft({}), maxTeams: '0', restrictToEmailList: true, emails: 'bad', appealsEnabled: true, appealPrice: 'x', neutral: 'RU, Belarus' };
    expect(settingsProblems(d)).toEqual(['MAX_TEAMS', 'EMAILS', 'APPEAL_PRICE', 'NEUTRAL']);
  });

  it('saves numbers, millimes and country codes', () => {
    const d = { ...settingsDraft({}), maxIndividuals: '120', appealsEnabled: true, appealPrice: '15', appealMax: '2', neutral: 'ru, by', restrictToEmailList: true, emails: 'a@x.tn' };
    expect(settingsBody(d)).toMatchObject({
      maxIndividuals: 120,
      maxTeams: null,
      invitedEmails: ['a@x.tn'],
      appeals: { enabled: true, price: 15000, maxPerAthlete: 2, deadline: null },
      neutralCountries: ['RU', 'BY'],
    });
  });

  it('reads saved settings back into the form', () => {
    const saved = settingsBody({ ...settingsDraft({}), maxTeams: '30', appealsEnabled: true, appealPrice: '12,5', emails: 'a@x.tn', neutral: 'RU' });
    expect(settingsDraft({ settings: saved })).toMatchObject({ maxTeams: '30', appealsEnabled: true, appealPrice: '12.5', emails: 'a@x.tn', neutral: 'RU' });
  });
});

describe('copy from a previous event', () => {
  const source = {
    eventStart: '2026-05-10T08:00:00.000Z',
    categories: [
      { id: 'k1', name: 'RX Men', gender: 'MALE', minAge: 18, maxAge: null, level: 'RX', maxParticipants: 40, registrationPriceOverride: 45000, active: true },
      { id: 'k2', name: 'Scaled Women', gender: 'FEMALE', minAge: null, maxAge: null, level: '', maxParticipants: null, registrationPriceOverride: null, active: true },
    ],
    workouts: [
      {
        id: 'w1',
        number: 1,
        name: 'WOD 1',
        description: 'AMRAP 12',
        scoreType: 'REPS',
        scoringMethod: 'PLACEMENT_POINTS',
        placementTable: [100, 95],
        maximumPoints: 100,
        minimumPoints: 0,
        submissionStart: '2026-05-10T08:00:00.000Z',
        submissionDeadline: '2026-05-11T18:00:00.000Z',
        releaseAt: '2026-05-09T08:00:00.000Z',
        variants: [
          { categoryId: 'k2', description: 'Scaled version' },
          { categoryId: 'gone', description: 'A category that was not copied' },
        ],
      },
    ],
  };

  it('copies the categories as new ones', () => {
    expect(copyCategoryBodies(source)).toEqual([
      { sourceId: 'k1', body: { name: 'RX Men', gender: 'MALE', minAge: 18, maxAge: null, level: 'RX', maxParticipants: 40, registrationPriceOverride: 45000 } },
      { sourceId: 'k2', body: { name: 'Scaled Women', gender: 'FEMALE', minAge: null, maxAge: null, level: '', maxParticipants: null, registrationPriceOverride: null } },
    ]);
  });

  it('moves the WOD dates to the new event and points the versions at the new categories', () => {
    const [wod] = copyWodBodies(source, new Date('2026-12-12T08:00:00.000Z'), { k2: 'n2' });
    expect(wod).toMatchObject({
      number: 1,
      name: 'WOD 1',
      scoringMethod: 'PLACEMENT_POINTS',
      placementTable: [100, 95],
      submissionStart: '2026-12-12T08:00:00.000Z',
      submissionDeadline: '2026-12-13T18:00:00.000Z',
      releaseAt: '2026-12-11T08:00:00.000Z',
    });
    expect(wod.variants).toEqual([{ categoryId: 'n2', description: 'Scaled version' }]);
  });
});
