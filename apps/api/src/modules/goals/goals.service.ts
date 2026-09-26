import { HttpStatus, Injectable } from '@nestjs/common';
import { ExperienceLevel, Goal, GoalMilestone, GoalType, MetricType, Prisma } from '@prisma/client';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { HealthDataCipher } from '../../common/crypto/health-data-cipher';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { harderLevel } from '../scoring/engine/fairness';
import { ExpectedProgressionService } from '../scoring/expected-progression.service';
import type { RuleSetConfig } from '../scoring/rule-set.schema';
import { RuleSetService } from '../scoring/rule-set.service';
import { PrivacyService } from '../users/privacy.service';
import { CreateGoalDto, SuggestGoalDto, UpdateGoalDto } from './dto/goal.dto';
import { creditedWeightChange, planMilestones, reached, roundFor, safeWeightWeeks, suggestTargets, weeksAtRate } from './goal-planning';

type Tx = Prisma.TransactionClient;

const METRICS_BY_TYPE: Record<GoalType, string[]> = {
  STRENGTH: ['E1RM', 'MAX_WEIGHT', 'MAX_REPS'],
  RUNNING: ['TIME_1K', 'TIME_5K', 'TIME_10K', 'TIME_21K', 'DISTANCE'],
  WEIGHT: ['BODY_WEIGHT'],
  HABIT: ['WORKOUTS_PER_WEEK'],
};
const MAX_ACTIVE_GOALS = 10;
const MAX_WEIGHT_CHANGE_PCT = 25;
const HABIT_WEEK_MILESTONES = [2, 4, 8, 12];
const UNREALISTIC_WEEKS = 104;
export const GOALS_DISCLAIMER_KEY = 'goals.disclaimer';

const bad = (code: string, detail: string, extra?: Record<string, unknown>) =>
  new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_FAILED, 'Invalid goal', { detail, errors: [{ field: 'targetValue', code }], extra });

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleSets: RuleSetService,
    private readonly expected: ExpectedProgressionService,
    private readonly privacy: PrivacyService,
    private readonly cipher: HealthDataCipher,
    private readonly ledger: LedgerService,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
  ) {}

  // ───────────────────────────── Create & manage ─────────────────────────────

  async create(userId: string, dto: CreateGoalDto) {
    const metric = await this.metric(dto.type, dto.metricCode);
    const { version, config } = await this.ruleSets.getActive();
    const exercise = await this.exerciseFor(dto.type, dto.exerciseId, metric.code);
    if ((await this.prisma.goal.count({ where: { userId, status: 'ACTIVE', deletedAt: null } })) >= MAX_ACTIVE_GOALS) {
      throw AppException.conflict(ErrorCode.CONFLICT, `At most ${MAX_ACTIVE_GOALS} active goals.`);
    }
    const duplicate = await this.prisma.goal.findFirst({ where: { userId, status: 'ACTIVE', deletedAt: null, metricTypeId: metric.id, exerciseId: exercise?.id ?? null } });
    if (duplicate) throw AppException.conflict(ErrorCode.CONFLICT, 'An active goal already exists for this metric.', { goalId: duplicate.id });

    const today = new Date(`${this.calendar.localDate(this.clock.now())}T00:00:00Z`);
    const requestedDate = dto.targetDate ? new Date(`${dto.targetDate.slice(0, 10)}T00:00:00Z`) : null;
    if (requestedDate && requestedDate <= today) throw AppException.validation([{ field: 'targetDate', code: 'MUST_BE_IN_FUTURE' }]);
    const round = (v: number) => roundFor(metric.unit, metric.code, v);

    let start: number;
    let milestones: { index: number; targetValue: number }[];
    let targetDate = requestedDate;
    let safetyAdjustment: Prisma.InputJsonObject | null = null;
    let direction: 'INCREASE' | 'DECREASE' = metric.direction === 'HIGHER_IS_BETTER' ? 'INCREASE' : 'DECREASE';

    if (dto.type === 'HABIT') {
      // Planned rest is part of the design: a habit goal can never ask for 7 days a week (docs §5).
      if (!Number.isInteger(dto.targetValue) || dto.targetValue > 6) throw bad('REST_DAY_REQUIRED', 'Plan at least one rest day per week (1–6 training days).');
      start = 0;
      milestones = HABIT_WEEK_MILESTONES.map((weeks, index) => ({ index, targetValue: weeks }));
    } else if (dto.type === 'WEIGHT') {
      const current = await this.privacy.latestWeightKg(userId);
      if (current === null) throw bad('NO_CURRENT_VALUE', 'Log your body weight first (requires health-data consent).');
      start = current;
      const target = round(dto.targetValue);
      if (target === round(start)) throw bad('TARGET_NOT_BETTER', 'The target equals your current weight.');
      if (target < 40 || target > 250 || (Math.abs(target - start) / start) * 100 > MAX_WEIGHT_CHANGE_PCT) {
        throw bad('UNSAFE_TARGET', `Weight goals are limited to ±${MAX_WEIGHT_CHANGE_PCT} % of your current weight.`);
      }
      direction = target < start ? 'DECREASE' : 'INCREASE';
      const weeks = safeWeightWeeks(start, target, config.weight_change_max_pct_per_week);
      const safeDate = new Date(today.getTime() + weeks * 7 * 86_400_000);
      if (!targetDate || targetDate < safeDate) {
        if (targetDate) safetyAdjustment = { reason: 'WEIGHT_RATE_LIMIT', requestedTargetDate: dto.targetDate!, maxPctPerWeek: config.weight_change_max_pct_per_week };
        targetDate = safeDate;
      }
      milestones = planMilestones(start, target, direction === 'DECREASE' ? -2 : 2, round);
    } else {
      start = await this.currentValue(userId, exercise!.id, metric);
      const target = round(dto.targetValue);
      const better = metric.direction === 'HIGHER_IS_BETTER' ? target > start : target < start;
      if (!better) throw bad('TARGET_NOT_BETTER', 'The target must be better than your current best.', { current: start });
      const pct = await this.expectedPct(userId, version, exercise!.id, metric.id);
      const fastWeeks = weeksAtRate(start, target, pct * 1.5, metric.direction);
      if (fastWeeks !== null && fastWeeks > UNREALISTIC_WEEKS) {
        throw bad('UNREALISTIC_TARGET', 'This target is more than two years of progress away. Pick a closer one.', {
          suggestions: suggestTargets(start, pct, metric.direction, round),
        });
      }
      const fastest = fastWeeks !== null ? new Date(today.getTime() + fastWeeks * 7 * 86_400_000) : null;
      if (targetDate && fastest && targetDate < fastest) {
        safetyAdjustment = { reason: 'TOO_FAST', requestedTargetDate: dto.targetDate!, earliestRealisticWeeks: fastWeeks };
        targetDate = fastest;
      }
      milestones = planMilestones(start, target, start * (pct / 100), round);
    }

    const target = dto.type === 'HABIT' ? dto.targetValue : round(dto.targetValue);
    const weight = dto.type === 'WEIGHT';
    const goal = await this.prisma.goal.create({
      data: {
        id: uuidv7(),
        userId,
        type: dto.type,
        exerciseId: exercise?.id ?? null,
        metricTypeId: metric.id,
        direction,
        startValue: weight ? null : start,
        targetValue: weight ? null : target,
        startValueEnc: weight ? this.cipher.encryptNumber(start) : null,
        targetValueEnc: weight ? this.cipher.encryptNumber(target) : null,
        startDate: today,
        targetDate,
        wasSuggested: dto.wasSuggested ?? false,
        safetyAdjustment: safetyAdjustment ?? Prisma.JsonNull,
        // Weight goals are health data: always private (docs §5).
        visibility: weight ? 'PRIVATE' : (dto.visibility ?? 'PRIVATE'),
        milestones: {
          create: milestones.map((m) => ({
            id: uuidv7(),
            index: m.index,
            targetValue: weight ? null : m.targetValue,
            targetValueEnc: weight ? this.cipher.encryptNumber(m.targetValue) : null,
          })),
        },
      },
      include: { milestones: true, metricType: true },
    });
    return { ...this.toView(goal), disclaimerKey: GOALS_DISCLAIMER_KEY };
  }

  async list(userId: string) {
    const goals = await this.prisma.goal.findMany({
      where: { userId, deletedAt: null },
      include: { milestones: { orderBy: { index: 'asc' } }, metricType: true },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    return goals.map((g) => this.toView(g));
  }

  async get(userId: string, id: string) {
    return this.toView(await this.owned(userId, id));
  }

  async update(userId: string, id: string, dto: UpdateGoalDto) {
    const goal = await this.owned(userId, id);
    if (goal.status !== 'ACTIVE') throw AppException.conflict(ErrorCode.CONFLICT, 'Only active goals can be edited.');
    const updated = await this.prisma.goal.update({
      where: { id },
      data: {
        targetDate: dto.targetDate ? new Date(`${dto.targetDate.slice(0, 10)}T00:00:00Z`) : undefined,
        visibility: goal.type === 'WEIGHT' ? undefined : dto.visibility,
      },
      include: { milestones: { orderBy: { index: 'asc' } }, metricType: true },
    });
    return this.toView(updated);
  }

  async abandon(userId: string, id: string): Promise<void> {
    const goal = await this.owned(userId, id);
    if (goal.status === 'ACTIVE') await this.prisma.goal.update({ where: { id }, data: { status: 'ABANDONED' } });
  }

  // ───────────────────────────── Suggestions ─────────────────────────────

  async suggestions(userId: string, dto: SuggestGoalDto) {
    const metric = await this.metric(dto.type, dto.metricCode);
    const exercise = await this.exerciseFor(dto.type, dto.exerciseId, metric.code);
    const { version } = await this.ruleSets.getActive();
    const current = await this.currentValue(userId, exercise!.id, metric);
    const pct = await this.expectedPct(userId, version, exercise!.id, metric.id);
    return {
      current,
      metric: { code: metric.code, unit: metric.unit, direction: metric.direction },
      expectedPctPer28Days: pct,
      suggestions: suggestTargets(current, pct, metric.direction, (v) => roundFor(metric.unit, metric.code, v)),
      disclaimerKey: GOALS_DISCLAIMER_KEY,
    };
  }

  // ───────────────────────────── Milestone crediting ─────────────────────────────

  /** Called by the scoring pipeline (same transaction) with the workout's best values. */
  async onWorkoutScored(
    tx: Tx,
    a: { userId: string; workoutId: string; performedAt: Date; observations: { exerciseId: string; metricCode: string; value: number }[]; skipExercises: Set<string>; ruleSetVersion: number; config: RuleSetConfig },
  ): Promise<void> {
    const goals = await tx.goal.findMany({
      where: { userId: a.userId, status: 'ACTIVE', deletedAt: null, type: { in: ['STRENGTH', 'RUNNING'] } },
      include: { milestones: { orderBy: { index: 'asc' } }, metricType: true },
    });
    for (const goal of goals) {
      if (!goal.exerciseId || a.skipExercises.has(goal.exerciseId)) continue;
      const obs = a.observations.find((o) => o.exerciseId === goal.exerciseId && o.metricCode === goal.metricType.code);
      if (!obs) continue;
      await this.creditMilestones(tx, goal, obs.value, a.workoutId, a.performedAt, a.ruleSetVersion, a.config);
    }
  }

  /** Body weight: only the safe-rate part of a change counts (docs §5: faster change earns nothing extra). */
  async onBodyMeasurement(userId: string): Promise<void> {
    const latest = await this.privacy.latestWeightKg(userId);
    if (latest === null) return;
    const { version, config } = await this.ruleSets.getActive();
    await this.prisma.$transaction(async (tx) => {
      const goals = await tx.goal.findMany({ where: { userId, type: 'WEIGHT', status: 'ACTIVE', deletedAt: null }, include: { milestones: { orderBy: { index: 'asc' } }, metricType: true } });
      for (const goal of goals) {
        const start = this.cipher.decryptNumber(goal.startValueEnc!);
        const weeks = (this.clock.now().getTime() - goal.startDate.getTime()) / (7 * 86_400_000);
        const credited = start + creditedWeightChange(latest - start, start, weeks, config.weight_change_max_pct_per_week);
        await this.creditMilestones(tx, goal, credited, null, this.clock.now(), version, config);
      }
    });
  }

  /** Called by the weekly close with the number of training days of the finished week. */
  async onWeekClosed(tx: Tx, userId: string, trainingDays: number, closedAt: Date, ruleSetVersion: number, config: RuleSetConfig): Promise<void> {
    const goals = await tx.goal.findMany({ where: { userId, type: 'HABIT', status: 'ACTIVE', deletedAt: null }, include: { milestones: { orderBy: { index: 'asc' } }, metricType: true } });
    for (const goal of goals) {
      const weeksMet = trainingDays >= Number(goal.targetValue) ? goal.habitWeeksMet + 1 : 0;
      await tx.goal.update({ where: { id: goal.id }, data: { habitWeeksMet: weeksMet } });
      await this.creditMilestones(tx, goal, weeksMet, null, closedAt, ruleSetVersion, config, 'HIGHER_IS_BETTER');
    }
  }

  /** Undo milestones credited by a workout that was edited or deleted. */
  async onWorkoutRevoked(tx: Tx, workoutId: string, ruleSetVersion: number, config: RuleSetConfig): Promise<void> {
    const milestones = await tx.goalMilestone.findMany({ where: { workoutId }, include: { goal: true } });
    for (const m of milestones) {
      if (m.xpTransactionId) await this.ledger.reverseXp(tx, m.xpTransactionId, 'workout edited or deleted', ruleSetVersion, config);
      await tx.goalMilestone.update({ where: { id: m.id }, data: { reachedAt: null, workoutId: null, xpTransactionId: null } });
      if (m.goal.status === 'COMPLETED') await tx.goal.update({ where: { id: m.goalId }, data: { status: 'ACTIVE' } });
    }
  }

  private async creditMilestones(
    tx: Tx,
    goal: Goal & { milestones: GoalMilestone[]; metricType: MetricType },
    value: number,
    workoutId: string | null,
    at: Date,
    ruleSetVersion: number,
    config: RuleSetConfig,
    directionOverride?: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER',
  ): Promise<void> {
    const direction = directionOverride ?? (goal.direction === 'INCREASE' ? 'HIGHER_IS_BETTER' : 'LOWER_IS_BETTER');
    for (const m of goal.milestones) {
      if (m.reachedAt) continue;
      const target = m.targetValueEnc ? this.cipher.decryptNumber(m.targetValueEnc) : Number(m.targetValue);
      if (!reached(value, target, direction)) break;
      const res = await this.ledger.appendXp(
        tx,
        {
          userId: goal.userId,
          amount: config.goal_milestone_xp,
          reason: 'GOAL_MILESTONE',
          sourceType: 'goal_milestone',
          sourceId: m.id,
          ruleSetVersion,
          effectiveAt: at,
          explanation: { formula: 'goal_milestone_xp', inputs: { goalId: goal.id, milestone: m.index + 1, of: goal.milestones.length }, ...(workoutId && { workoutId }), result: config.goal_milestone_xp },
        },
        config,
      );
      await tx.goalMilestone.update({ where: { id: m.id }, data: { reachedAt: at, workoutId, xpTransactionId: res.id } });
      m.reachedAt = at;
    }
    if (goal.milestones.every((m) => m.reachedAt)) {
      await tx.goal.update({ where: { id: goal.id }, data: { status: 'COMPLETED' } });
      await tx.activityEvent.create({
        data: { id: uuidv7(), userId: goal.userId, type: 'GOAL_COMPLETED', refType: 'goal', refId: goal.id, visibility: goal.visibility, payload: { type: goal.type } },
      });
    }
  }

  // ───────────────────────────── Internals ─────────────────────────────

  private async metric(type: GoalType, code: string): Promise<MetricType> {
    if (!METRICS_BY_TYPE[type].includes(code)) throw AppException.validation([{ field: 'metricCode', code: 'NOT_ALLOWED_FOR_TYPE' }]);
    return this.prisma.metricType.findUniqueOrThrow({ where: { code } });
  }

  private async exerciseFor(type: GoalType, exerciseId: string | undefined, metricCode: string) {
    if (type === 'WEIGHT' || type === 'HABIT') {
      if (exerciseId) throw AppException.validation([{ field: 'exerciseId', code: 'NOT_ALLOWED_FOR_TYPE' }]);
      return null;
    }
    if (!exerciseId) throw AppException.validation([{ field: 'exerciseId', code: 'REQUIRED' }]);
    const exercise = await this.prisma.exercise.findUnique({ where: { id: exerciseId } });
    if (!exercise || !exercise.trackedMetrics.includes(metricCode)) throw AppException.validation([{ field: 'exerciseId', code: 'METRIC_NOT_TRACKED' }]);
    return exercise;
  }

  /** Current best: the current record, else the baseline (declared or calibrated). */
  private async currentValue(userId: string, exerciseId: string, metric: MetricType): Promise<number> {
    const pr = await this.prisma.personalRecord.findFirst({ where: { userId, exerciseId, metricTypeId: metric.id, qualifier: 0, isCurrent: true } });
    if (pr) return Number(pr.value);
    const baseline = await this.prisma.baseline.findUnique({ where: { userId_exerciseId_metricTypeId: { userId, exerciseId, metricTypeId: metric.id } } });
    if (baseline) return Number(baseline.effectiveValue);
    throw bad('NO_CURRENT_VALUE', 'Log this exercise (or declare your current level) first.');
  }

  private async expectedPct(userId: string, version: number, exerciseId: string, metricTypeId: string): Promise<number> {
    const lookup = await this.expected.lookup(version);
    const [profile, baseline] = await Promise.all([
      this.prisma.profile.findUnique({ where: { userId } }),
      this.prisma.baseline.findUnique({ where: { userId_exerciseId_metricTypeId: { userId, exerciseId, metricTypeId } } }),
    ]);
    const level: ExperienceLevel = harderLevel([profile?.experienceLevelDeclared, baseline?.experienceLevel ?? 'BEGINNER'], (l) => lookup(l, exerciseId, metricTypeId));
    return lookup(level, exerciseId, metricTypeId) ?? 1;
  }

  private async owned(userId: string, id: string) {
    const goal = await this.prisma.goal.findUnique({ where: { id }, include: { milestones: { orderBy: { index: 'asc' } }, metricType: true } });
    if (!goal || goal.userId !== userId || goal.deletedAt) throw AppException.notFound('Goal');
    return goal;
  }

  private toView(g: Goal & { milestones: GoalMilestone[]; metricType: MetricType }) {
    const dec = (plain: Prisma.Decimal | null, enc: Uint8Array | null) => (enc ? this.cipher.decryptNumber(enc) : plain === null ? null : Number(plain));
    const milestones = [...g.milestones].sort((a, b) => a.index - b.index);
    return {
      id: g.id,
      type: g.type,
      exerciseId: g.exerciseId,
      metric: { code: g.metricType.code, unit: g.metricType.unit },
      direction: g.direction,
      startValue: dec(g.startValue, g.startValueEnc),
      targetValue: dec(g.targetValue, g.targetValueEnc),
      startDate: g.startDate.toISOString().slice(0, 10),
      targetDate: g.targetDate?.toISOString().slice(0, 10) ?? null,
      status: g.status,
      visibility: g.visibility,
      wasSuggested: g.wasSuggested,
      safetyAdjustment: g.safetyAdjustment,
      habitWeeksMet: g.type === 'HABIT' ? g.habitWeeksMet : undefined,
      milestones: milestones.map((m) => ({ index: m.index, targetValue: dec(m.targetValue, m.targetValueEnc), reachedAt: m.reachedAt?.toISOString() ?? null })),
      milestonesReached: milestones.filter((m) => m.reachedAt).length,
    };
  }
}
