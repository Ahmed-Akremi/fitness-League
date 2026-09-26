import { Injectable } from '@nestjs/common';
import { ClockService } from '../../common/clock/clock.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RuleSetConfig, ruleSetConfigSchema } from './rule-set.schema';

export interface ActiveRuleSet {
  version: number;
  config: RuleSetConfig;
}

const CACHE_TTL_MS = 30_000;

/**
 * Reads the ACTIVE scoring rule set. Cached briefly per process; activation (admin module) calls `invalidate()`.
 * ASSUMPTION: with several API instances the cache is invalidated via Redis pub/sub (arrives with Redis, module 8).
 */
@Injectable()
export class RuleSetService {
  private cache: { value: ActiveRuleSet; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async getActive(): Promise<ActiveRuleSet> {
    const now = this.clock.now().getTime();
    if (this.cache && this.cache.expiresAt > now) return this.cache.value;
    const row = await this.prisma.scoringRuleSet.findFirst({ where: { status: 'ACTIVE' } });
    if (!row) throw new Error('No ACTIVE scoring rule set: run the seed or activate one in admin.');
    const value = { version: row.version, config: ruleSetConfigSchema.parse(row.config) };
    this.cache = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  }

  invalidate(): void {
    this.cache = null;
  }
}
