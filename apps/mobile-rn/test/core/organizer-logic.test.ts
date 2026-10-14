import {
  catBody,
  catDraft,
  catValid,
  datesValid,
  fromMillimes,
  missingForPublication,
  nextWodNumber,
  publicationState,
  slugFor,
  toMillimes,
  wodBody,
  wodDraft,
  wodValid,
} from '../../src/features/competitions/organizer/logic';

const d = (iso: string) => new Date(iso);

describe('slugFor', () => {
  it('keeps the Latin letters and digits of the title and adds the suffix', () => {
    expect(slugFor('Sousse Summer Throwdown 2026!', 'ab12')).toBe('sousse-summer-throwdown-2026-ab12');
  });
  it('drops accents', () => expect(slugFor('Défi Été', 'x1y2')).toBe('defi-ete-x1y2'));
  it('falls back to event- when the title has no Latin letter', () => expect(slugFor('بطولة سوسة', 'k9z0')).toBe('event-k9z0'));
  it('always matches the server rule, 80 characters max', () => {
    for (const title of ['  --  ', '🏋️🔥', 'A'.repeat(200), 'Été — Sousse / Monastir']) expect(slugFor(title)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(slugFor('A'.repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe('dates and money', () => {
  it('uses the server rules for dates', () => {
    expect(datesValid({ registrationStart: d('2026-10-01'), registrationEnd: d('2026-10-10'), eventStart: d('2026-10-12'), eventEnd: d('2026-10-12') })).toBe(true);
    expect(datesValid({ registrationStart: d('2026-10-10'), registrationEnd: d('2026-10-10'), eventStart: d('2026-10-12'), eventEnd: d('2026-10-13') })).toBe(false);
    expect(datesValid({ registrationStart: d('2026-10-01'), registrationEnd: d('2026-10-10'), eventStart: d('2026-10-13'), eventEnd: d('2026-10-12') })).toBe(false);
  });
  it('reads TND amounts into millimes', () => {
    expect(toMillimes('35')).toBe(35000);
    expect(toMillimes('12,5')).toBe(12500);
    expect(toMillimes(' 0 ')).toBe(0);
    for (const bad of ['', 'abc', '-3', '1.2345']) expect(toMillimes(bad)).toBeNull();
    expect(fromMillimes(35000)).toBe('35');
    expect(fromMillimes(null)).toBe('');
  });
});

describe('publication', () => {
  const ready = {
    description: 'Two days on site.',
    deadlines: { registrationStart: '2026-10-01T00:00:00Z' },
    registrationEnd: '2026-10-10T00:00:00Z',
    eventStart: '2026-10-12T00:00:00Z',
    eventEnd: '2026-10-13T00:00:00Z',
    coverUrl: 'https://cdn/c.webp',
    categories: [{ id: 'k', active: true }],
    workouts: [{ id: 'w', number: 1 }],
    status: 'DRAFT',
  };
  it('lists what the draft misses', () => {
    expect(missingForPublication(ready)).toEqual([]);
    expect(missingForPublication({ ...ready, description: '  ', coverUrl: null, categories: [{ id: 'k', active: false }], workouts: [] })).toEqual(['DESCRIPTION', 'COVER', 'CATEGORY', 'WOD']);
  });
  it('tells the publication state', () => {
    expect(publicationState(ready)).toBe('DRAFT');
    expect(publicationState({ ...ready, publicationRequestedAt: '2026-10-14T10:00:00Z' })).toBe('REQUESTED');
    expect(publicationState({ ...ready, publicationNote: 'Blurred banner' })).toBe('RETURNED');
    expect(publicationState({ ...ready, status: 'REGISTRATION_OPEN' })).toBe('PUBLISHED');
  });
});

describe('categories', () => {
  it('validates and builds the request', () => {
    const c = { ...catDraft(null), name: 'RX Men 18-35', gender: 'MALE' as const, minAge: '18', maxAge: '35', level: 'RX', max: '40', price: '45' };
    expect(catValid(c)).toBe(true);
    expect(catBody(c)).toEqual({ name: 'RX Men 18-35', gender: 'MALE', minAge: 18, maxAge: 35, level: 'RX', maxParticipants: 40, registrationPriceOverride: 45000 });
    expect(catBody({ ...c, minAge: '', maxAge: '', max: '', price: '' })).toMatchObject({ minAge: null, maxAge: null, maxParticipants: null, registrationPriceOverride: null });
    expect(catValid({ ...c, name: 'R' })).toBe(false);
    expect(catValid({ ...c, minAge: '40' })).toBe(false);
    expect(catValid({ ...c, price: 'free' })).toBe(false);
  });
  it('reads an existing category', () => {
    expect(catDraft({ id: 'k', name: 'Scaled', gender: 'MIXED', minAge: null, maxAge: null, level: null, maxParticipants: null, registrationPriceOverride: 20000, active: false })).toEqual({
      id: 'k',
      name: 'Scaled',
      gender: 'MIXED',
      minAge: '',
      maxAge: '',
      level: '',
      max: '',
      price: '20',
      active: false,
    });
  });
});

describe('WODs', () => {
  const defaults = { number: 3, start: d('2026-10-12T08:00:00Z'), end: d('2026-10-13T18:00:00Z') };
  it('starts a new WOD on reps per movement, inside the event dates', () => {
    const w = wodDraft(null, defaults);
    expect(w).toMatchObject({ number: 3, name: 'WOD 3', scoreType: 'MOVEMENT_REPS', method: 'DIRECT_POINTS', max: '100' });
    expect(nextWodNumber([{ number: 1 }, { number: 4 }])).toBe(5);
    expect(nextWodNumber([])).toBe(1);
  });
  it('needs movements worth points for reps per movement', () => {
    const base = { ...wodDraft(null, defaults), description: 'AMRAP 12' };
    expect(wodValid({ ...base, movements: [{ name: '', points: '1' }] })).toBe(false);
    expect(wodValid({ ...base, movements: [{ name: 'Burpees', points: '0' }] })).toBe(false);
    const ok = { ...base, movements: [{ name: 'Burpees', points: '1' }, { name: 'Wall balls', points: '0,5' }, { name: '', points: '1' }] };
    expect(wodValid(ok)).toBe(true);
    expect(wodBody(ok)).toEqual({
      number: 3,
      name: 'WOD 3',
      description: 'AMRAP 12',
      standards: '',
      scoreType: 'MOVEMENT_REPS',
      scoringMethod: 'DIRECT_POINTS',
      maximumPoints: 100,
      minimumPoints: 0,
      movements: [
        { name: 'Burpees', pointsPerRep: 1 },
        { name: 'Wall balls', pointsPerRep: 0.5 },
      ],
      submissionStart: '2026-10-12T08:00:00.000Z',
      submissionDeadline: '2026-10-13T18:00:00.000Z',
    });
  });
  it('checks points, placement table, cap and dates', () => {
    const base = { ...wodDraft(null, defaults), description: 'For time', scoreType: 'TIME', movements: [] };
    expect(wodValid(base)).toBe(true);
    expect(wodValid({ ...base, min: '120' })).toBe(false);
    expect(wodValid({ ...base, method: 'PLACEMENT_POINTS', table: '100, 95, 97' })).toBe(false);
    expect(wodValid({ ...base, method: 'PLACEMENT_POINTS', table: '100, 95, 90' })).toBe(true);
    expect(wodBody({ ...base, method: 'PLACEMENT_POINTS', table: '100, 95, 90', capMin: '12' })).toMatchObject({ placementTable: [100, 95, 90], timeCapS: 720, movements: [] });
    expect(wodValid({ ...base, capMin: '0' })).toBe(false);
    expect(wodValid({ ...base, end: defaults.start })).toBe(false);
  });
  it('reads an existing WOD back', () => {
    const w = wodDraft(
      { id: 'w1', number: 2, name: 'WOD 2', description: 'x', standards: null, scoreType: 'TIME', scoringMethod: 'PLACEMENT_POINTS', placementTable: [100, 90], maximumPoints: 100, minimumPoints: 0, timeCapS: 600, videoUrl: null, movements: [], submissionStart: '2026-10-12T08:00:00Z', submissionDeadline: '2026-10-12T20:00:00Z' },
      defaults,
    );
    expect(w).toMatchObject({ id: 'w1', number: 2, method: 'PLACEMENT_POINTS', table: '100, 90', capMin: '10', standards: '', videoUrl: '' });
  });
});
