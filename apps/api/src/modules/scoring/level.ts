import type { RuleSetConfig } from './rule-set.schema';

type LevelRules = Pick<RuleSetConfig, 'level_base_xp' | 'level_exponent' | 'level_titles'>;

/** XP needed to go from level n to n+1: base × n^exponent (docs §5.6). */
export function xpToNextLevel(level: number, rules: LevelRules): number {
  return Math.round(rules.level_base_xp * level ** rules.level_exponent);
}

export function levelFromXp(xpTotal: number, rules: LevelRules): { level: number; xpIntoLevel: number; xpForNextLevel: number } {
  let level = 1;
  let remaining = Math.max(0, xpTotal);
  let next = xpToNextLevel(level, rules);
  while (remaining >= next) {
    remaining -= next;
    level += 1;
    next = xpToNextLevel(level, rules);
  }
  return { level, xpIntoLevel: remaining, xpForNextLevel: next };
}

/** i18n key of the title for a level (the last title whose `fromLevel` is reached). */
export function levelTitleKey(level: number, rules: LevelRules): string {
  let key = rules.level_titles[0]!.key;
  for (const t of rules.level_titles) if (level >= t.fromLevel) key = t.key;
  return key;
}
