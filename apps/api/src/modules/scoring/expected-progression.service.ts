import { Injectable } from '@nestjs/common';
import type { ExperienceLevel } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Expected improvement (% per progress window) by level × exercise × metric (docs §9.3).
 * Exercise-specific rows win over generic ones (exercise = null). Cached per rule-set version.
 */
@Injectable()
export class ExpectedProgressionService {
  private cache: { version: number; rows: Map<string, number> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async lookup(version: number): Promise<(level: ExperienceLevel, exerciseId: string, metricTypeId: string) => number | null> {
    if (!this.cache || this.cache.version !== version) {
      const rows = await this.prisma.expectedProgression.findMany({ where: { ruleSet: { version } } });
      this.cache = { version, rows: new Map(rows.map((r) => [`${r.experienceLevel}|${r.exerciseId ?? '*'}|${r.metricTypeId}`, Number(r.expectedPct)])) };
    }
    const rows = this.cache.rows;
    return (level, exerciseId, metricTypeId) => rows.get(`${level}|${exerciseId}|${metricTypeId}`) ?? rows.get(`${level}|*|${metricTypeId}`) ?? null;
  }
}
