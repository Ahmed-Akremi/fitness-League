import { categoryOf, inQuietHours, normalisePrefs, shouldPush } from './push-policy';

describe('push policy', () => {
  it('maps notification types to categories', () => {
    expect(['FRIEND_REQUEST', 'ACTIVITY_COMMENT', 'DUEL_MATCHED', 'BATTLE_RESULT', 'GYM_WAR_RESULT', 'CHALLENGE_COMPLETED', 'BADGE_AWARDED', 'GYM_WOD_SCORE_INVALIDATED'].map(categoryOf)).toEqual([
      'SOCIAL',
      'SOCIAL',
      'BATTLES',
      'BATTLES',
      'COMPETITION',
      'CHALLENGES',
      'BADGES',
      'GYM',
    ]);
  });

  it('defaults every category to on', () => {
    expect(normalisePrefs({}, null).categories).toEqual({ SOCIAL: true, BATTLES: true, COMPETITION: true, CHALLENGES: true, BADGES: true, GYM: true });
    expect(normalisePrefs({ categories: { SOCIAL: false } }, null).categories.SOCIAL).toBe(false);
  });

  it('handles quiet hours that cross midnight', () => {
    const q = { start: '22:00', end: '07:00' };
    expect(inQuietHours('23:30', q)).toBe(true);
    expect(inQuietHours('06:59', q)).toBe(true);
    expect(inQuietHours('07:00', q)).toBe(false);
    expect(inQuietHours('12:00', { start: '12:00', end: '14:00' })).toBe(true);
    expect(inQuietHours('12:00', null)).toBe(false);
  });

  it('pushes only enabled categories outside quiet hours', () => {
    const prefs = normalisePrefs({ categories: { SOCIAL: false } }, { start: '22:00', end: '07:00' });
    expect(shouldPush('ACTIVITY_REACTION', prefs, '12:00')).toBe(false);
    expect(shouldPush('BATTLE_RESULT', prefs, '12:00')).toBe(true);
    expect(shouldPush('BATTLE_RESULT', prefs, '23:00')).toBe(false);
  });
});
