import {
  seedHeats,
  ageOn,
  applyPenalty,
  canRegister,
  canSubmit,
  checkCoupon,
  checkEligibility,
  clampPoints,
  leaderboard,
  movementPoints,
  nextVersion,
  placementPoints,
  placements,
  podium,
  quote,
  rawValue,
  scoredMovements,
  totalPoints,
  youtubeId,
  type AthleteScores,
  type CouponRule,
} from './domain';

const now = new Date('2026-10-01T10:00:00Z');

describe('pricing (§8, §9, §64)', () => {
  it('uses the competition price, or the category override when set', () => {
    expect(quote(35_000, null)).toEqual({ originalPrice: 35_000, discount: 0, finalPrice: 35_000, paymentStatus: 'PENDING' });
    expect(quote(30_000, 40_000).originalPrice).toBe(40_000);
  });

  it('FREE coupon: 35 → 0 and payment FREE (§14)', () => {
    expect(quote(35_000, null, { type: 'FREE', value: 0 })).toEqual({ originalPrice: 35_000, discount: 35_000, finalPrice: 0, paymentStatus: 'FREE' });
  });

  it('percentage and fixed coupons never go below 0', () => {
    expect(quote(35_000, null, { type: 'PERCENTAGE', value: 20 }).finalPrice).toBe(28_000);
    expect(quote(20_000, null, { type: 'FIXED_AMOUNT', value: 50_000 })).toMatchObject({ discount: 20_000, finalPrice: 0, paymentStatus: 'FREE' });
  });
});

describe('coupons (§14)', () => {
  const coupon: CouponRule = { code: 'FREE2026', type: 'FREE', value: 0, active: true, maxUses: 2, usedCount: 0, expiresAt: new Date('2026-12-31T00:00:00Z'), competitionId: 'c1', categoryId: null, minimumAmount: null };
  const ctx = { competitionId: 'c1', categoryId: 'rx-m', amount: 35_000, now, alreadyUsedByAthlete: false };

  it('accepts a valid coupon', () => expect(checkCoupon(coupon, ctx)).toBeNull());
  it('refuses inactive, expired, exhausted, other competition/category, minimum and reuse', () => {
    expect(checkCoupon({ ...coupon, active: false }, ctx)).toBe('COUPON_INACTIVE');
    expect(checkCoupon({ ...coupon, expiresAt: new Date('2026-09-01T00:00:00Z') }, ctx)).toBe('COUPON_EXPIRED');
    expect(checkCoupon({ ...coupon, usedCount: 2 }, ctx)).toBe('COUPON_EXHAUSTED');
    expect(checkCoupon({ ...coupon, competitionId: 'c2' }, ctx)).toBe('COUPON_OTHER_COMPETITION');
    expect(checkCoupon({ ...coupon, categoryId: 'scaled-f' }, ctx)).toBe('COUPON_OTHER_CATEGORY');
    expect(checkCoupon({ ...coupon, minimumAmount: 50_000 }, ctx)).toBe('COUPON_MINIMUM_NOT_MET');
    expect(checkCoupon(coupon, { ...ctx, alreadyUsedByAthlete: true })).toBe('COUPON_ALREADY_USED');
  });
});

describe('eligibility (§11)', () => {
  const rxFemale = { gender: 'FEMALE' as const, minAge: 18, maxAge: 35, active: true, maxParticipants: null };
  const master40 = { gender: 'MALE' as const, minAge: 40, maxAge: null, active: true, maxParticipants: null };
  const rxMale = { ...rxFemale, gender: 'MALE' as const };
  const male27 = { gender: 'MALE' as const, dateOfBirth: new Date('1999-03-15T00:00:00Z') };
  const ctx = { referenceDate: new Date('2026-10-12T00:00:00Z'), registeredCount: 0 };

  it('computes the age on the reference date (birthday not yet passed)', () => {
    expect(ageOn(new Date('1990-10-13T00:00:00Z'), new Date('2026-10-12T00:00:00Z'))).toBe(35);
    expect(ageOn(new Date('1990-10-12T00:00:00Z'), new Date('2026-10-12T00:00:00Z'))).toBe(36);
  });

  it('a 27-year-old man fits RX Male 18-35 but not RX Female nor Master 40+', () => {
    expect(checkEligibility(rxMale, male27, ctx)).toBeNull();
    expect(checkEligibility(rxFemale, male27, ctx)).toBe('WRONG_GENDER');
    expect(checkEligibility(master40, male27, ctx)).toBe('TOO_YOUNG');
  });

  it('needs a declared gender for gendered categories, and checks capacity and activity', () => {
    expect(checkEligibility(rxMale, { gender: 'UNDISCLOSED', dateOfBirth: male27.dateOfBirth }, ctx)).toBe('GENDER_REQUIRED');
    expect(checkEligibility({ ...rxMale, maxParticipants: 1 }, male27, { ...ctx, registeredCount: 1 })).toBe('CATEGORY_FULL');
    expect(checkEligibility({ ...rxMale, active: false }, male27, ctx)).toBe('CATEGORY_INACTIVE');
    expect(checkEligibility({ ...rxMale, maxAge: 25 }, male27, ctx)).toBe('TOO_OLD');
  });
});

describe('WOD points (§18, §20, §21)', () => {
  it('reads raw values per score type, capped times rank after finishers', () => {
    expect(rawValue('TIME', { timeS: 522 })).toBe(522);
    expect(rawValue('ROUNDS_REPS', { rounds: 12, repsPerRound: 30, reps: 7 })).toBe(367);
    expect(rawValue('TIME', { capped: true, capS: 900, maxReps: 150, reps: 140 })).toBe(910);
    expect(rawValue('LOAD', { value: 120 })).toBe(120);
  });

  it('MOVEMENT_REPS: the app computes the score from the reps of each movement × its points per rep', () => {
    const movements = [{ name: 'Burpees', pointsPerRep: 1 }, { name: 'Wall balls', pointsPerRep: 0.5 }];
    expect(movementPoints(movements, [60, 75])).toBe(97.5);
    expect(rawValue('MOVEMENT_REPS', { movements, movementReps: [60, 75] })).toBe(97.5);
    expect(movementPoints(movements, [0, 0])).toBe(0);
    // One whole, non-negative count per movement, nothing else.
    expect(movementPoints(movements, [60])).toBeNull();
    expect(movementPoints(movements, [60, -1])).toBeNull();
    expect(movementPoints(movements, [60, 7.5])).toBeNull();
    expect(movementPoints(movements, '60,75')).toBeNull();
    expect(movementPoints([], [])).toBeNull();
    expect(movementPoints([{ name: 'Row', pointsPerRep: 0.1 }], [3])).toBe(0.3); // no float noise
  });

  it('reads stored WOD movements, older plain names being worth 0 points', () => {
    expect(scoredMovements([{ name: 'Burpees', pointsPerRep: 1 }, 'Rope climb'])).toEqual([{ name: 'Burpees', pointsPerRep: 1 }, { name: 'Rope climb', pointsPerRep: 0 }]);
    expect(scoredMovements(null)).toEqual([]);
  });

  it('places results (ties share) — lower time wins, higher load wins', () => {
    const times = placements([{ id: 'a', value: 500 }, { id: 'b', value: 480 }, { id: 'c', value: 500 }], 'TIME');
    expect([times.get('b'), times.get('a'), times.get('c')]).toEqual([1, 2, 2]);
    expect(placements([{ id: 'a', value: 100 }, { id: 'b', value: 120 }], 'LOAD').get('b')).toBe(1);
  });

  it('turns a placement into the WOD table points, continuing the last step and never under the minimum', () => {
    const table = [100, 95, 90, 85, 80];
    expect(placementPoints(1, table)).toBe(100);
    expect(placementPoints(5, table)).toBe(80);
    expect(placementPoints(7, table)).toBe(70);
    expect(placementPoints(40, table, 10)).toBe(10);
  });

  it('clamps direct points to the WOD range', () => {
    expect(clampPoints(160, 150)).toBe(150);
    expect(clampPoints(-5, 150)).toBe(0);
  });
});

describe('score versions and penalties (§28-§30)', () => {
  it('keeps every version; the latest is the current one', () => {
    let h = nextVersion([], { points: 95, reason: 'submitted', judgeId: null, at: now });
    h = nextVersion(h, { points: applyPenalty(95, 10), reason: 'No rep', judgeId: 'j1', at: now });
    h = nextVersion(h, { points: 80, reason: 'Adjusted', judgeId: 'hj', at: now });
    expect(h.map((v) => [v.version, v.points])).toEqual([
      [1, 95],
      [2, 85],
      [3, 80],
    ]);
  });
});

describe('leaderboard (§31-§35, §58, §62)', () => {
  const order = ['w1', 'w2', 'w3', 'w4'];
  const ahmed: AthleteScores = { athleteId: 'ahmed', points: { w1: 95, w2: 90, w3: 140, w4: 175 } };
  const ali: AthleteScores = { athleteId: 'ali', points: { w1: 90, w2: 100, w3: 120, w4: 160 } };
  const mehdi: AthleteScores = { athleteId: 'mehdi', points: { w1: 85, w2: 88, w3: 95, w4: 180 } };

  it('TOTAL is the sum of the official WOD points: Ahmed = 500', () => {
    expect(totalPoints(ahmed)).toBe(500);
  });

  it('ranks by total desc, and recalculates when a judge changes WOD 3 (140 → 125)', () => {
    expect(leaderboard([mehdi, ali, ahmed], [], order).map((r) => [r.athleteId, r.total, r.rank])).toEqual([
      ['ahmed', 500, 1],
      ['ali', 470, 2],
      ['mehdi', 448, 3],
    ]);
    const after = leaderboard([mehdi, ali, { ...ahmed, points: { ...ahmed.points, w3: 125 } }], [], order);
    expect(after[0]).toMatchObject({ athleteId: 'ahmed', total: 485, rank: 1 });
  });

  it('applies the organizer tie-break rules in order, and shares the rank when none separates', () => {
    const a: AthleteScores = { athleteId: 'a', points: { w1: 100, w2: 50 } };
    const b: AthleteScores = { athleteId: 'b', points: { w1: 50, w2: 100 } };
    expect(leaderboard([a, b], [], ['w1', 'w2']).map((r) => r.rank)).toEqual([1, 1]);
    expect(leaderboard([a, b], [{ type: 'LAST_WOD' }], ['w1', 'w2'])[0].athleteId).toBe('b');
    expect(leaderboard([a, b], [{ type: 'WOD', workoutId: 'w1' }], ['w1', 'w2'])[0].athleteId).toBe('a');
  });

  it('builds the podium from the final ranks', () => {
    const p = podium(leaderboard([ahmed, ali, mehdi], [], order));
    expect([p.gold[0].athleteId, p.silver[0].athleteId, p.bronze[0].athleteId]).toEqual(['ahmed', 'ali', 'mehdi']);
  });
});

describe('deadlines (§43) and video (§24)', () => {
  const comp = { status: 'REGISTRATION_OPEN' as const, registrationStart: new Date('2026-09-01T00:00:00Z'), registrationEnd: new Date('2026-10-10T00:00:00Z') };

  it('registration follows the status and the server clock', () => {
    expect(canRegister(comp, now)).toBeNull();
    expect(canRegister(comp, new Date('2026-10-11T00:00:00Z'))).toBe('REGISTRATION_CLOSED');
    expect(canRegister({ ...comp, status: 'DRAFT' }, now)).toBe('REGISTRATION_CLOSED');
  });

  it('submissions only inside the WOD window while the competition runs', () => {
    const wod = { active: true, submissionStart: new Date('2026-10-01T00:00:00Z'), submissionDeadline: new Date('2026-10-05T00:00:00Z') };
    expect(canSubmit(wod, { status: 'SUBMISSION_OPEN' }, now)).toBeNull();
    expect(canSubmit(wod, { status: 'JUDGING' }, now)).toBe('SUBMISSION_CLOSED');
    expect(canSubmit({ ...wod, active: false }, { status: 'SUBMISSION_OPEN' }, now)).toBe('SUBMISSION_CLOSED');
  });

  it('extracts YouTube ids from every common URL form and rejects others', () => {
    for (const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://m.youtube.com/embed/dQw4w9WgXcQ?t=3']) {
      expect(youtubeId(url)).toBe('dQw4w9WgXcQ');
    }
    expect(youtubeId('https://vimeo.com/123')).toBeNull();
    expect(youtubeId('not a url')).toBeNull();
    expect(youtubeId('https://youtube.com/watch?v=short')).toBeNull();
  });
});

describe('heat seeding (§45)', () => {
  it('runs the leaders last and keeps every heat but the first full', () => {
    const bestFirst = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'];
    expect(seedHeats(bestFirst, 3)).toEqual([['a7'], ['a4', 'a5', 'a6'], ['a1', 'a2', 'a3']]);
    expect(seedHeats(bestFirst, 7)).toEqual([bestFirst]);
    expect(seedHeats(['a1', 'a2', 'a3', 'a4'], 2)).toEqual([['a3', 'a4'], ['a1', 'a2']]);
  });
  it('handles nobody and refuses zero lanes', () => {
    expect(seedHeats([], 8)).toEqual([]);
    expect(() => seedHeats(['a1'], 0)).toThrow();
  });
});
