import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ExercisesQueryDto } from './reference.dto';

@Injectable()
export class ReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async countries() {
    const rows = await this.prisma.country.findMany({ where: { enabled: true }, orderBy: { code: 'asc' } });
    return rows.map((c) => ({ code: c.code, name: c.nameI18n }));
  }

  async governorates() {
    const rows = await this.prisma.governorate.findMany({ where: { country: { enabled: true } }, orderBy: { code: 'asc' } });
    return rows.map((g) => ({ id: g.id, code: g.code, countryCode: g.countryCode, name: g.nameI18n }));
  }

  async cities(governorateId: string) {
    const rows = await this.prisma.city.findMany({ where: { governorateId }, orderBy: { code: 'asc' } });
    return rows.map((c) => ({ id: c.id, code: c.code, governorateId: c.governorateId, name: c.nameI18n }));
  }

  async sports() {
    const rows = await this.prisma.sport.findMany({ where: { enabled: true }, orderBy: { code: 'asc' } });
    return rows.map((s) => ({ id: s.id, code: s.code, category: s.category, loggingMode: s.loggingMode, icon: s.icon, name: s.nameI18n }));
  }

  async metricTypes() {
    const rows = await this.prisma.metricType.findMany({ orderBy: { code: 'asc' } });
    return rows.map((m) => ({ id: m.id, code: m.code, unit: m.unit, direction: m.direction, name: m.nameI18n }));
  }

  async exercises(q: ExercisesQueryDto) {
    const where: Prisma.ExerciseWhereInput = {};
    if (q.sportId) {
      const sport = await this.prisma.sport.findUnique({ where: { id: q.sportId } });
      if (!sport) throw AppException.notFound('Sport');
      // Shared exercises (no sport) only make sense for strength/functional sports, not for e.g. swimming.
      where.OR = sport.category === 'CARDIO' ? [{ sportId: sport.id }] : [{ sportId: sport.id }, { sportId: null }];
    }
    if (q.updatedSince) {
      where.updatedAt = { gt: new Date(q.updatedSince) };
    } else {
      where.enabled = true; // a delta sync must also see disabled rows, to remove them locally
    }
    const rows = await this.prisma.exercise.findMany({ where, orderBy: { code: 'asc' } });
    return rows.map((e) => ({
      id: e.id,
      code: e.code,
      sportId: e.sportId,
      name: e.nameI18n,
      equipment: e.equipment,
      isBodyweight: e.isBodyweight,
      trackedMetrics: e.trackedMetrics,
      group: e.group,
      description: e.descriptionI18n,
      enabled: e.enabled,
      updatedAt: e.updatedAt.toISOString(),
    }));
  }
}
