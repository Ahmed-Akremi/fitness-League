/**
 * Which notifications may become a push (docs §3.9, Q-17): athletes switch categories off and set quiet hours;
 * the in-app list always keeps everything.
 */

export const PUSH_CATEGORIES = ['SOCIAL', 'BATTLES', 'COMPETITION', 'CHALLENGES', 'BADGES', 'GYM'] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number];

export function categoryOf(type: string): PushCategory {
  if (type.startsWith('FRIEND_') || type.startsWith('ACTIVITY_')) return 'SOCIAL';
  if (type.startsWith('BATTLE_') || type.startsWith('DUEL_')) return 'BATTLES';
  if (type.startsWith('GYM_WAR_')) return 'COMPETITION';
  if (type.startsWith('CHALLENGE_')) return 'CHALLENGES';
  if (type.startsWith('BADGE_')) return 'BADGES';
  return 'GYM';
}

export interface PushPrefs {
  categories: Record<PushCategory, boolean>;
  /** Local times "HH:MM" (Africa/Tunis); the window may cross midnight. */
  quietHours: { start: string; end: string } | null;
}

export function normalisePrefs(stored: unknown, quiet: { start: string; end: string } | null): PushPrefs {
  const raw = stored && typeof stored === 'object' ? ((stored as Record<string, unknown>).categories ?? {}) : {};
  const categories = Object.fromEntries(PUSH_CATEGORIES.map((c) => [c, (raw as Record<string, unknown>)[c] !== false])) as Record<PushCategory, boolean>;
  return { categories, quietHours: quiet };
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/** True when `localTime` ("HH:MM") falls inside the quiet window [start, end). */
export function inQuietHours(localTime: string, quiet: PushPrefs['quietHours']): boolean {
  if (!quiet || quiet.start === quiet.end) return false;
  const t = minutes(localTime);
  const s = minutes(quiet.start);
  const e = minutes(quiet.end);
  return s < e ? t >= s && t < e : t >= s || t < e;
}

export function shouldPush(type: string, prefs: PushPrefs, localTime: string): boolean {
  return prefs.categories[categoryOf(type)] && !inQuietHours(localTime, prefs.quietHours);
}
