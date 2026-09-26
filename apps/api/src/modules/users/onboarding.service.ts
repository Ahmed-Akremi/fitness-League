import { HttpStatus, Injectable } from '@nestjs/common';
import { ClockService } from '../../common/clock/clock.service';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RuleSetService } from '../scoring/rule-set.service';
import { OnboardingBaselinesDto, OnboardingSportsDto } from './dto/onboarding.dto';


/** Onboarding steps 2–6 (docs §6). Goals (step 4) and gym (step 5) have their own modules. */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleSets: RuleSetService,
    private readonly clock: ClockService,
  ) {}

  async state(userId: string) {
    const [profile, sports, baselines, goals, gym] = await Promise.all([
      this.prisma.profile.findUniqueOrThrow({ where: { userId } }),
      this.prisma.userSport.count({ where: { userId } }),
      this.prisma.baseline.count({ where: { userId } }),
      this.prisma.goal.count({ where: { userId, deletedAt: null } }),
      this.prisma.gymMember.count({ where: { userId, status: { in: ['PENDING', 'APPROVED'] } } }),
    ]);
    return {
      steps: { sports: sports > 0, baselines: baselines > 0, goals: goals > 0, gym: gym > 0 },
      completed: profile.onboardingCompletedAt !== null,
      calibrationEndsAt: profile.calibrationEndsAt?.toISOString() ?? null,
    };
  }

  async setSports(userId: string, dto: OnboardingSportsDto) {
    if (!dto.sportIds.includes(dto.primarySportId)) {
      throw AppException.validation([{ field: 'primarySportId', code: 'NOT_IN_SPORT_IDS' }]);
    }
    const found = await this.prisma.sport.count({ where: { id: { in: dto.sportIds }, enabled: true } });
    if (found !== dto.sportIds.length) throw AppException.validation([{ field: 'sportIds', code: 'UNKNOWN_SPORT' }]);
    await this.prisma.$transaction([
      this.prisma.userSport.deleteMany({ where: { userId } }),
      this.prisma.userSport.createMany({ data: dto.sportIds.map((sportId) => ({ userId, sportId, isPrimary: sportId === dto.primarySportId })) }),
    ]);
    return this.state(userId);
  }

  /**
   * Declared values are a hint only (docs §9.2): they create PROVISIONAL baselines, which calibration replaces
   * by max(declared, best logged). Once a baseline is FINAL, declarations can no longer change it.
   */
  async declareBaselines(userId: string, dto: OnboardingBaselinesDto) {
    const exercises = await this.prisma.exercise.findMany({ where: { id: { in: dto.entries.map((e) => e.exerciseId) } } });
    const metrics = await this.prisma.metricType.findMany({ where: { code: { in: dto.entries.map((e) => e.metricCode) } } });
    const byId = new Map(exercises.map((e) => [e.id, e]));
    const byCode = new Map(metrics.map((m) => [m.code, m]));

    const rows = dto.entries.map((entry, i) => {
      const exercise = byId.get(entry.exerciseId);
      const metric = byCode.get(entry.metricCode);
      if (!exercise) throw AppException.validation([{ field: `entries[${i}].exerciseId`, code: 'UNKNOWN_EXERCISE' }]);
      if (!metric || !exercise.trackedMetrics.includes(metric.code)) {
        throw AppException.validation([{ field: `entries[${i}].metricCode`, code: 'METRIC_NOT_TRACKED' }]);
      }
      return { exerciseId: exercise.id, metricTypeId: metric.id, value: entry.value };
    });

    await this.prisma.$transaction(async (tx) => {
      for (const r of rows) {
        const existing = await tx.baseline.findUnique({
          where: { userId_exerciseId_metricTypeId: { userId, exerciseId: r.exerciseId, metricTypeId: r.metricTypeId } },
        });
        if (existing && existing.status !== 'PROVISIONAL') continue;
        await tx.baseline.upsert({
          where: { userId_exerciseId_metricTypeId: { userId, exerciseId: r.exerciseId, metricTypeId: r.metricTypeId } },
          update: { declaredValue: r.value, effectiveValue: r.value },
          create: { id: uuidv7(), userId, exerciseId: r.exerciseId, metricTypeId: r.metricTypeId, declaredValue: r.value, effectiveValue: r.value },
        });
      }
    });
    return this.state(userId);
  }

  /** Starts the calibration period. Idempotent: completing twice keeps the original dates. */
  async complete(userId: string) {
    const profile = await this.prisma.profile.findUniqueOrThrow({ where: { userId } });
    if (profile.onboardingCompletedAt) return this.state(userId);
    if ((await this.prisma.userSport.count({ where: { userId } })) === 0) {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.PRECONDITION_FAILED, 'Select at least one sport first', {
        extra: { missingStep: 'sports' },
      });
    }
    const { config } = await this.ruleSets.getActive();
    const now = this.clock.now();
    await this.prisma.profile.update({
      where: { userId },
      data: {
        onboardingCompletedAt: now,
        calibrationStartedAt: now,
        calibrationEndsAt: new Date(now.getTime() + config.calibration_days * 86_400_000),
      },
    });
    return this.state(userId);
  }
}
