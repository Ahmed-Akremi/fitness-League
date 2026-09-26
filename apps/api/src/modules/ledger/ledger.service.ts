import { Injectable } from '@nestjs/common';
import { LpReason, Prisma, XpReason } from '@prisma/client';
import { uuidv7 } from '../../common/ids/uuid';
import { levelFromXp } from '../scoring/level';
import type { RuleSetConfig } from '../scoring/rule-set.schema';

type Tx = Prisma.TransactionClient;

export interface XpEntry {
  userId: string;
  amount: number;
  reason: XpReason;
  sourceType: string;
  sourceId: string;
  ruleSetVersion: number;
  explanation: Prisma.InputJsonObject;
  effectiveAt: Date;
  createdById?: string | null;
}

export interface LpEntry extends Omit<XpEntry, 'reason'> {
  reason: LpReason;
  seasonId: string;
}

/**
 * The only writer of XP / League Point ledgers (docs §5.8). Entries are append-only; balances in
 * `user_stats` are a cache updated in the same transaction and reconciled nightly.
 */
@Injectable()
export class LedgerService {
  async appendXp(tx: Tx, e: XpEntry, levels: LevelRules): Promise<{ id: string; levelUp: { from: number; to: number } | null }> {
    const id = uuidv7();
    await tx.xpTransaction.create({ data: { id, ...e } });
    const levelUp = await this.applyXp(tx, e.userId, e.amount, levels);
    return { id, levelUp };
  }

  async appendLp(tx: Tx, e: LpEntry, divisions: RuleSetConfig['division_thresholds']): Promise<string> {
    const id = uuidv7();
    await tx.leaguePointTransaction.create({ data: { id, ...e } });
    await this.applyLp(tx, e.userId, e.seasonId, e.amount, divisions);
    return id;
  }

  /** Inserts the opposite entry. The DB guarantees an entry is reversed at most once. */
  async reverseXp(tx: Tx, originalId: string, why: string, ruleSetVersion: number, levels: LevelRules, actorId: string | null = null): Promise<string | null> {
    const o = await tx.xpTransaction.findUnique({ where: { id: originalId }, include: { reversal: true } });
    if (!o || o.reversal || o.reason === 'REVERSAL') return null;
    const id = uuidv7();
    await tx.xpTransaction.create({
      data: {
        id,
        userId: o.userId,
        amount: -o.amount,
        reason: 'REVERSAL',
        sourceType: o.sourceType,
        sourceId: o.sourceId,
        reversesId: o.id,
        ruleSetVersion,
        explanation: { reverses: o.id, why },
        effectiveAt: o.effectiveAt,
        createdById: actorId,
      },
    });
    await this.applyXp(tx, o.userId, -o.amount, levels);
    return id;
  }

  async reverseLp(tx: Tx, originalId: string, why: string, ruleSetVersion: number, divisions: RuleSetConfig['division_thresholds'], actorId: string | null = null): Promise<string | null> {
    const o = await tx.leaguePointTransaction.findUnique({ where: { id: originalId }, include: { reversal: true } });
    if (!o || o.reversal || o.reason === 'REVERSAL') return null;
    const id = uuidv7();
    await tx.leaguePointTransaction.create({
      data: {
        id,
        userId: o.userId,
        seasonId: o.seasonId,
        amount: -o.amount,
        reason: 'REVERSAL',
        sourceType: o.sourceType,
        sourceId: o.sourceId,
        reversesId: o.id,
        ruleSetVersion,
        explanation: { reverses: o.id, why },
        effectiveAt: o.effectiveAt,
        createdById: actorId,
      },
    });
    await this.applyLp(tx, o.userId, o.seasonId, -o.amount, divisions);
    return id;
  }

  private async applyXp(tx: Tx, userId: string, delta: number, levels: LevelRules): Promise<{ from: number; to: number } | null> {
    // Row lock: concurrent grants for the same user serialise here.
    const [stats] = await tx.$queryRaw<{ xp_total: bigint; level: number }[]>`SELECT xp_total, level FROM user_stats WHERE user_id = ${userId}::uuid FOR UPDATE`;
    const total = Number(stats?.xp_total ?? 0) + delta;
    const l = levelFromXp(total, levels);
    await tx.userStats.upsert({
      where: { userId },
      update: { xpTotal: total, level: l.level, xpIntoLevel: l.xpIntoLevel, xpForNextLevel: l.xpForNextLevel },
      create: { userId, xpTotal: total, level: l.level, xpIntoLevel: l.xpIntoLevel, xpForNextLevel: l.xpForNextLevel },
    });
    const before = stats?.level ?? 1;
    return l.level > before ? { from: before, to: l.level } : null;
  }

  private async applyLp(tx: Tx, userId: string, seasonId: string, delta: number, thresholds: RuleSetConfig['division_thresholds']): Promise<void> {
    const [stats] = await tx.$queryRaw<{ season_lp: number; current_season_id: string | null }[]>`SELECT season_lp, current_season_id FROM user_stats WHERE user_id = ${userId}::uuid FOR UPDATE`;
    // Only entries of the user's current season move the live balance; past-season corrections stay in history.
    if (stats && stats.current_season_id && stats.current_season_id !== seasonId) return;
    const lp = Math.max(0, (stats?.season_lp ?? 0) + delta);
    const division = await tx.division.findUnique({ where: { code: divisionFor(lp, thresholds) } });
    await tx.userStats.upsert({
      where: { userId },
      update: { seasonLp: lp, currentSeasonId: seasonId, divisionId: division?.id },
      create: { userId, seasonLp: lp, currentSeasonId: seasonId, divisionId: division?.id },
    });
  }
}

export type LevelRules = Pick<RuleSetConfig, 'level_base_xp' | 'level_exponent' | 'level_titles'>;

/** Live division from LP thresholds (ASSUMPTION Q-3). */
export function divisionFor(lp: number, thresholds: RuleSetConfig['division_thresholds']): 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'DIAMOND' | 'ELITE' {
  const ordered = (['ELITE', 'DIAMOND', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE'] as const).filter((d) => thresholds[d] !== undefined);
  return ordered.find((d) => lp >= thresholds[d]!) ?? 'BRONZE';
}
