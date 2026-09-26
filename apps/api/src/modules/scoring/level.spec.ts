import { levelFromXp, levelTitleKey, xpToNextLevel } from './level';

const rules = {
  level_base_xp: 100,
  level_exponent: 1.5,
  level_titles: [
    { fromLevel: 1, key: 'beginner' },
    { fromLevel: 6, key: 'rookie' },
    { fromLevel: 16, key: 'athlete' },
  ],
};

describe('level curve', () => {
  it('follows base × n^1.5', () => {
    expect(xpToNextLevel(1, rules)).toBe(100);
    expect(xpToNextLevel(4, rules)).toBe(800);
    expect(xpToNextLevel(18, rules)).toBe(7637);
  });

  it('derives level and progress from total XP', () => {
    expect(levelFromXp(0, rules)).toEqual({ level: 1, xpIntoLevel: 0, xpForNextLevel: 100 });
    expect(levelFromXp(99, rules)).toEqual({ level: 1, xpIntoLevel: 99, xpForNextLevel: 100 });
    // 100 (1→2) + 283 (2→3) = 383
    expect(levelFromXp(383, rules)).toEqual({ level: 3, xpIntoLevel: 0, xpForNextLevel: 520 });
  });

  it('never goes below level 1 (moderation reversals can make XP negative temporarily)', () => {
    expect(levelFromXp(-50, rules).level).toBe(1);
  });

  it('picks the title of the highest reached threshold', () => {
    expect([1, 5, 6, 15, 16, 99].map((l) => levelTitleKey(l, rules))).toEqual(['beginner', 'beginner', 'rookie', 'rookie', 'athlete', 'athlete']);
  });
});
