import { ApiError } from '../../src/core/api/errors';
import {
  announcementValid,
  autoBody,
  autoValid,
  batchCodes,
  couponBody,
  couponDraft,
  couponValid,
  createCoupons,
  delayMinutes,
  delayTargets,
  distribution,
  filterHeats,
  filterRegistrations,
  freeLanes,
  heatBody,
  heatDays,
  heatDraft,
  heatValid,
  laneCandidates,
  normalizeCode,
  personName,
  registrationsCsv,
  runDelay,
  shiftedStart,
  staffByRole,
  timetable,
  toCollect,
  topUsed,
} from '../../src/features/competitions/organizer/logic-b';
import { regs } from '../organizer-fixtures';

const at = (s: string) => Date.parse(s);
const heat = (id: string, startsAt: string | null, durationMin: number | null, extra: object = {}) => ({
  id,
  name: `Heat ${id.toUpperCase()}`,
  startsAt,
  durationMin,
  laneCount: 4,
  lanes: [],
  workout: { id: 'w1', name: 'WOD 1', number: 1 },
  category: { id: 'k1', name: 'RX Men' },
  ...extra,
});

describe('participants', () => {
  it('finds a name without accents or case, and filters by category and payment', () => {
    const none = { q: '', categoryId: null, payment: 'ALL' as const };
    expect(filterRegistrations(regs, { ...none, q: 'kefi' }).map((r) => r.id)).toEqual(['r3']);
    expect(filterRegistrations(regs, { ...none, q: 'SAMI_RX' }).map((r) => r.id)).toEqual(['r1']);
    expect(filterRegistrations(regs, { ...none, categoryId: 'k2' }).map((r) => r.id)).toEqual(['r2', 'r4']);
    expect(filterRegistrations(regs, { ...none, payment: 'PAID' }).map((r) => r.id)).toEqual(['r2']);
  });

  it('finds one athlete among 300', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ ...regs[0], id: `m${i}`, user: { username: `athlete${i}`, profile: { fullName: `Athlète ${i}` } } }));
    expect(filterRegistrations(many, { q: 'athlete 287', categoryId: null, payment: 'ALL' }).map((r) => r.id)).toEqual(['m287']);
  });

  it('« to collect »: payment pending, registration not cancelled, oldest first', () => {
    expect(toCollect(regs).map((r) => r.id)).toEqual(['r4', 'r1']);
  });

  it('exports one CSV line per registration, quoting what needs it', () => {
    const lines = registrationsCsv([regs[0], { ...regs[1], user: { username: 'amira', profile: { fullName: 'Trabelsi, "Amira"' } } }]).split('\n');
    expect(lines[0]).toBe('name,username,category,registration,payment,amount,currency,registered_at');
    expect(lines[1]).toBe('Sami Ben Ali,sami_rx,RX Men,PENDING,PENDING,40.000,TND,2026-10-21T09:00:00.000Z');
    expect(lines[2]).toBe('"Trabelsi, ""Amira""",amira,RX Women,CONFIRMED,PAID,35.000,TND,2026-10-20T09:00:00.000Z');
  });

  it('names a person from a registration, a staff row or a lane', () => {
    expect(personName(regs[0])).toBe('Sami Ben Ali');
    expect(personName({ user: { username: 'solo', profile: null } })).toBe('solo');
    expect(personName({ athlete: { fullName: null, username: 'lane_guy' } })).toBe('lane_guy');
  });
});

describe('planning', () => {
  const day = [heat('a', '2026-12-12T08:00:00.000Z', 12), heat('b', '2026-12-12T09:00:00.000Z', 12), heat('c', '2026-12-12T10:00:00.000Z', 12), heat('d', null, 12)];

  it('free lanes, and who can still go in a heat', () => {
    const h = heat('h', null, null, { lanes: [{ lane: 1, registrationId: 'r3' }, { lane: 3, registrationId: 'x' }] });
    expect(freeLanes(h)).toEqual([2, 4]);
    // r1 and r4 are not confirmed, r2 is in RX Women, r3 is already in the heat, r5 is cancelled.
    expect(laneCandidates(h, regs)).toEqual([]);
    const karim = { ...regs[0], id: 'r6', registrationStatus: 'CONFIRMED' };
    expect(laneCandidates(h, [...regs, karim]).map((r) => r.id)).toEqual(['r6']);
    expect(laneCandidates({ ...h, category: null }, [...regs, karim]).map((r) => r.id)).toEqual(['r2', 'r6']);
  });

  it('filters by day, category, WOD and athlete', () => {
    const list = [
      heat('a', '2026-12-12T10:00:00.000Z', 12, { lanes: [{ lane: 1, registrationId: 'r3', athlete: { fullName: 'Hédi Kéfi', username: 'hedi' } }] }),
      heat('b', '2026-12-13T10:00:00.000Z', 12, { category: { id: 'k2', name: 'RX Women' } }),
      heat('c', null, null),
    ];
    const none = { day: null, categoryId: null, workoutId: null, q: '' };
    expect(heatDays(list)).toEqual(['2026-12-12', '2026-12-13']);
    expect(filterHeats(list, { ...none, day: '2026-12-13' }).map((h) => h.id)).toEqual(['b']);
    expect(filterHeats(list, { ...none, categoryId: 'k2' }).map((h) => h.id)).toEqual(['b']);
    expect(filterHeats(list, { ...none, workoutId: 'w2' })).toEqual([]);
    expect(filterHeats(list, { ...none, q: 'hedi' }).map((h) => h.id)).toEqual(['a']);
  });

  it('the clock: heat running, next heat, heats done (heats without a start are not counted)', () => {
    expect(timetable(day, at('2026-12-12T09:05:00Z'))).toMatchObject({ current: { id: 'b' }, next: { id: 'c' }, done: 1, total: 3 });
    expect(timetable(day, at('2026-12-12T09:30:00Z'))).toMatchObject({ current: null, next: { id: 'c' }, done: 2, total: 3 });
    expect(timetable(day, at('2026-12-12T12:00:00Z'))).toMatchObject({ current: null, next: null, done: 3, total: 3 });
  });

  it('« Retard » targets only the heats that have not started, in running order', () => {
    expect(delayTargets([day[2], day[0], day[3], day[1]], at('2026-12-12T08:30:00Z')).map((h) => h.id)).toEqual(['b', 'c']);
    expect(shiftedStart(day[2], 15)).toBe('2026-12-12T10:15:00.000Z');
    expect(delayMinutes('15')).toBe(15);
    for (const bad of ['0', '601', '2.5', '', 'x', '-5']) expect(delayMinutes(bad)).toBeNull();
  });

  it('runs the delay heat by heat and returns the heats that failed', async () => {
    const later = [heat('c', '2026-12-12T10:00:00.000Z', 12), heat('e', '2026-12-12T11:00:00.000Z', 12), heat('f', '2026-12-12T12:00:00.000Z', 12)];
    const sent: [string, string][] = [];
    const failed = await runDelay(later, 10, async (id, startsAt) => {
      sent.push([id, startsAt]);
      if (id === 'e') throw new Error('offline');
    });
    expect(sent).toEqual([
      ['c', '2026-12-12T10:10:00.000Z'],
      ['e', '2026-12-12T11:10:00.000Z'],
      ['f', '2026-12-12T12:10:00.000Z'],
    ]);
    expect(failed.map((h) => h.id)).toEqual(['e']);
  });

  it('heat form: server limits, and only what is filled is sent', () => {
    const d = heatDraft(null);
    expect(heatValid(d)).toBe(true);
    for (const bad of [{ lanes: '0' }, { lanes: '41' }, { lanes: '' }, { duration: '601' }, { name: 'x'.repeat(81) }]) expect(heatValid({ ...d, ...bad })).toBe(false);
    expect(heatBody({ ...d, name: ' Final ', workoutId: 'w1', start: new Date('2026-12-13T15:00:00Z'), duration: '20', lanes: '6' })).toEqual({ name: 'Final', workoutId: 'w1', startsAt: '2026-12-13T15:00:00.000Z', durationMin: 20, laneCount: 6 });
    expect(heatDraft(heat('h', '2026-12-12T08:00:00.000Z', null))).toMatchObject({ id: 'h', name: 'Heat H', workoutId: 'w1', categoryId: 'k1', duration: '', lanes: '4' });
  });

  it('automatic heats need a category and 1 to 40 lanes', () => {
    const d = { categoryId: 'k1', workoutId: null, lanes: '8', start: null, interval: '15' };
    expect(autoValid(d)).toBe(true);
    expect(autoValid({ ...d, categoryId: null })).toBe(false);
    expect(autoValid({ ...d, lanes: '' })).toBe(false);
    expect(autoValid({ ...d, interval: '0' })).toBe(false);
    expect(autoBody(d)).toEqual({ categoryId: 'k1', laneCount: 8, intervalMin: 15 });
    expect(autoBody({ ...d, workoutId: 'w2', start: new Date('2026-12-12T08:00:00Z'), interval: '' })).toEqual({ categoryId: 'k1', workoutId: 'w2', laneCount: 8, startsAt: '2026-12-12T08:00:00.000Z' });
  });
});

describe('team', () => {
  it('groups the staff by role, names in alphabetical order', () => {
    const rows = [
      { id: 's1', role: 'JUDGE', user: { username: 'zed' } },
      { id: 's2', role: 'ORGANIZER', user: { username: 'b', profile: { fullName: 'Bilel' } } },
      { id: 's3', role: 'ORGANIZER', user: { username: 'a', profile: { fullName: 'Amel' } } },
    ];
    const g = staffByRole(rows);
    expect(g.ORGANIZER.map((s) => s.id)).toEqual(['s3', 's2']);
    expect(g.HEAD_JUDGE).toEqual([]);
    expect(g.JUDGE.map((s) => s.id)).toEqual(['s1']);
  });
});

describe('promo codes', () => {
  it('batch codes and the form rules', () => {
    expect(normalizeCode(' summer 20 ')).toBe('SUMMER-20');
    expect(batchCodes('VIP', 1)).toEqual(['VIP']);
    expect(batchCodes('VIP', 3)).toEqual(['VIP-1', 'VIP-2', 'VIP-3']);
    const d = { ...couponDraft(), code: 'summer20' };
    expect(couponValid(d)).toBe(true);
    for (const bad of [{ code: 'ab' }, { value: '0' }, { value: '101' }, { value: '' }, { quantity: '51' }, { quantity: '0' }, { maxUses: '0' }]) expect(couponValid({ ...d, ...bad })).toBe(false);
    expect(couponValid({ ...d, type: 'FIXED_AMOUNT', value: '12,5' })).toBe(true);
    expect(couponValid({ ...d, type: 'FIXED_AMOUNT', value: '0' })).toBe(false);
    expect(couponValid({ ...d, type: 'FREE', value: '' })).toBe(true);
    // Every code of the batch must fit the 32 characters: AAA…A-10 does not.
    expect(couponValid({ ...d, code: 'A'.repeat(30), quantity: '12' })).toBe(false);
  });

  it('sends what the server expects for each type', () => {
    const d = { ...couponDraft(), categoryId: 'k1', maxUses: '20', expires: new Date('2026-12-01T22:00:00Z') };
    expect(couponBody({ ...d, type: 'PERCENTAGE', value: '20' }, 'SUMMER')).toEqual({ code: 'SUMMER', type: 'PERCENTAGE', value: 20, categoryId: 'k1', maxUses: 20, expiresAt: '2026-12-01T22:00:00.000Z' });
    expect(couponBody({ ...couponDraft(), type: 'FIXED_AMOUNT', value: '12,5' }, 'TEN')).toEqual({ code: 'TEN', type: 'FIXED_AMOUNT', value: 12500 });
    expect(couponBody({ ...couponDraft(), type: 'FREE', value: '50' }, 'GIFT')).toEqual({ code: 'GIFT', type: 'FREE' });
  });

  it('creates a batch one code at a time: a taken code is skipped, another error stops it', async () => {
    const taken = new ApiError('client', 422, 'VALIDATION_FAILED', [{ field: 'code', code: 'TAKEN' }]);
    const seen: string[] = [];
    const ok = await createCoupons(['A-1', 'A-2', 'A-3'], async (code) => {
      seen.push(code);
      if (code === 'A-2') throw taken;
    });
    expect(ok).toEqual({ created: ['A-1', 'A-3'], taken: ['A-2'], error: null });
    expect(seen).toEqual(['A-1', 'A-2', 'A-3']);
    const down = new ApiError('server', 500, 'INTERNAL');
    const stopped = await createCoupons(['B-1', 'B-2', 'B-3'], async (code) => {
      if (code === 'B-2') throw down;
    });
    expect(stopped).toEqual({ created: ['B-1'], taken: [], error: down });
  });

  it('top 5 of the codes in use', () => {
    const list = [3, 0, 9, 1, 4, 7, 2].map((n, i) => ({ id: `p${i}`, code: `C${i}`, usedCount: n }));
    expect(topUsed(list).map((c) => c.usedCount)).toEqual([9, 7, 4, 3, 2]);
    expect(topUsed([{ id: 'p', code: 'P', usedCount: 0 }])).toEqual([]);
  });
});

describe('announcements', () => {
  it('title 3 to 120 characters, message 1 to 5000, spaces not counted', () => {
    expect(announcementValid('Heat 3 moved', 'Now at 15:30.')).toBe(true);
    expect(announcementValid('  ab ', 'x')).toBe(false);
    expect(announcementValid('Title', '   ')).toBe(false);
    expect(announcementValid('x'.repeat(121), 'x')).toBe(false);
  });
});

describe('dashboard breakdown', () => {
  it('per category, women / men from the category, per day; cancelled registrations left out', () => {
    const cats = [
      { id: 'k1', name: 'RX Men', gender: 'MALE' },
      { id: 'k2', name: 'RX Women', gender: 'FEMALE' },
      { id: 'k3', name: 'Teams', gender: 'MIXED' },
    ];
    const d = distribution(regs, cats);
    expect(d.byCategory).toEqual([
      { id: 'k1', name: 'RX Men', count: 2 },
      { id: 'k2', name: 'RX Women', count: 2 },
    ]);
    expect([d.women, d.men, d.mixed]).toEqual([2, 2, 0]);
    expect(d.perDay).toEqual([
      { day: '2026-10-19', count: 1 },
      { day: '2026-10-20', count: 1 },
      { day: '2026-10-21', count: 2 },
    ]);
  });
});
