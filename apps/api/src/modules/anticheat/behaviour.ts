/**
 * Phase 3 behavioural anti-cheat (docs §7.3). Pure detectors: they only raise flags for a moderator, never punish.
 */

export interface SpikeResult {
  z: number;
  mean: number;
  sd: number;
}

/** Weekly total far above the athlete's own history (> `threshold` σ, with enough history and a meaningful score). */
export function scoreSpike(history: number[], current: number, threshold = 3, minWeeks = 4, minScore = 50): SpikeResult | null {
  if (history.length < minWeeks || current < minScore) return null;
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const sd = Math.sqrt(history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length);
  // A perfectly flat history gives no spread: require a clear jump instead of dividing by ~0.
  const z = sd < 1 ? (current - mean >= 30 ? Infinity : 0) : (current - mean) / sd;
  return z > threshold ? { z: Number.isFinite(z) ? Math.round(z * 100) / 100 : 99, mean: Math.round(mean * 10) / 10, sd: Math.round(sd * 10) / 10 } : null;
}

/** Many workouts barely above the minimum duration in one week: farming XP rather than training. */
export function farming(durationsS: number[], minDurationS: number, minCount = 6, share = 0.8, marginS = 5 * 60): { count: number; nearMinimum: number } | null {
  if (durationsS.length < minCount) return null;
  const nearMinimum = durationsS.filter((d) => d >= minDurationS && d <= minDurationS + marginS).length;
  return nearMinimum / durationsS.length >= share ? { count: durationsS.length, nearMinimum } : null;
}

/** Friend battles between the same two athletes whose winner keeps alternating: trading wins for LP. */
export function battleCollusion(outcomesForA: ('WIN' | 'LOSS' | 'DRAW')[], minBattles = 4): { battles: number } | null {
  if (outcomesForA.length < minBattles) return null;
  if (outcomesForA.includes('DRAW')) return null;
  const alternates = outcomesForA.every((o, i) => i === 0 || o !== outcomesForA[i - 1]);
  return alternates ? { battles: outcomesForA.length } : null;
}
