import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GoalsService } from '../goals/goals.service';
import { LedgerService } from '../ledger/ledger.service';
import { PrOutcome, ProgressService } from '../progress/progress.service';
import { PrivacyService } from '../users/privacy.service';
import type { WorkoutInput } from '../workouts/workout-metrics';
import { applyCaps, diminishingMultiplier, prXp, workoutXp } from './engine/xp';
import { ExpectedProgressionService } from './expected-progression.service';
import { RuleSetService } from './rule-set.service';

type Tx = Prisma.TransactionClient;

/** XP events eligible for the daily/weekly caps (quests are onboarding rewards and stay outside). */
const CAPPED_SOURCE = ['workout', 'pr'];
/** Metrics whose PRs earn XP; REPS_AT_WEIGHT records are kept for history only. */
const XP_METRICS = new Set(['E1RM', 'MAX_WEIGHT', 'MAX_REPS', 'DISTANCE', 'PACE', 'TIME_1K', 'TIME_5K', 'TIME_10K', 'TIME_21K']);
/** When one workout improves several metrics of an exercise, only the most meaningful one is rewarded. */
const PR_PRIORITY = ['E1RM', 'TIME_21K', 'TIME_10K', 'TIME_5K', 'TIME_1K', 'MAX_WEIGHT', 'PACE', 'MAX_REPS', 'DISTANCE'];

/**
 * Consumes workout events from the outbox and turns them into progress, records and XP (docs §5.3).
 * Every write is idempotent: processing the same event twice changes nothing.
 */
@Injectable()
export class WorkoutScoringService {
  private readonly logger = new Logger(WorkoutScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleSets: RuleSetService,
    private readonly expected: ExpectedProgressionService,
    private readonly progress: ProgressService,
    private readonly ledger: LedgerService,
    private readonly privacy: PrivacyService,
    private readonly goals: GoalsService,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
  ) {}

  async onAccepted(workoutId: string): Promise<void> {
    const { version: ruleSetVersion, config } = await this.ruleSets.getActive();
    const expected = await this.expected.lookup(ruleSetVersion);
    const bodyWeightKg = await this.privacy.latestWeightKg((await this.prisma.workout.findUniqueOrThrow({ where: { id: workoutId } })).userId);

    await this.prisma.$transaction(async (tx) => {
      const w = await tx.workout.findUniqueOrThrow({
        where: { id: workoutId },
        include: { exercises: { orderBy: { position: 'asc' }, include: { exercise: true, sets: { orderBy: { setIndex: 'asc' } } } }, evaluation: true, user: { include: { profile: true } } },
      });
      if (w.status !== 'ACCEPTED' || w.deletedAt) return;
      const sourceId = `${w.id}#v${w.version}`;
      if (await tx.xpTransaction.findFirst({ where: { userId: w.userId, sourceType: 'workout', sourceId } })) return; // already processed
      if (await tx.metricObservation.findFirst({ where: { workoutId: w.id } })) return; // processed, no workout XP (short / late)

      const hits = (w.evaluation?.ruleHits ?? []) as { rule: string }[];
      const countsForCompetition = !hits.some((h) => h.rule === 'LATE_LOG');
      const profile = w.user.profile;
      const calibrationEnds = profile?.calibrationEndsAt ?? null;
      const inCalibration = !calibrationEnds || w.performedAt < calibrationEnds;
      const input: WorkoutInput = {
        sportId: w.sportId,
        workoutType: w.workoutType,
        performedAt: w.performedAt,
        durationS: w.durationS,
        exercises: w.exercises.map((e) => ({
          exerciseId: e.exerciseId,
          exerciseCode: e.exercise.code,
          isBodyweight: e.exercise.isBodyweight,
          sets: e.sets.map((s) => ({
            reps: s.reps,
            weightKg: s.weightKg === null ? null : Number(s.weightKg),
            distanceM: s.distanceM,
            durationS: s.durationS,
            isWarmup: s.isWarmup,
          })),
        })),
      };
      const tracked = new Map(w.exercises.map((e) => [e.exerciseId, e.exercise.trackedMetrics]));

      const { prs, observations } = await this.progress.recordWorkout(tx, {
        userId: w.userId,
        workoutId: w.id,
        input,
        tracked: (id) => tracked.get(id) ?? [],
        config,
        expected,
        inCalibration,
        calibrationOver: !!calibrationEnds && this.clock.now() >= calibrationEnds,
        declaredLevel: profile?.experienceLevelDeclared ?? null,
        bodyWeightKg,
        countsForCompetition,
      });

      await tx.activityEvent.create({
        data: { id: uuidv7(), userId: w.userId, type: 'WORKOUT', refType: 'workout', refId: w.id, visibility: w.visibility, payload: { sportId: w.sportId, durationS: w.durationS } },
      });
      for (const pr of prs.filter((p) => p.status === 'AWARDED' && XP_METRICS.has(p.metricCode))) {
        await tx.activityEvent.create({
          data: { id: uuidv7(), userId: w.userId, type: 'PR', refType: 'personal_record', refId: pr.prId, visibility: w.visibility, payload: { exerciseId: pr.exerciseId, metric: pr.metricCode, value: pr.value, previous: pr.previousValue } },
        });
      }

      await this.updateDailyStreak(tx, w.userId, w.performedAt);

      if (!countsForCompetition) return; // > 72 h late: history and progress only (docs §7.1)
      const levels = config;
      const grant = async (reason: 'WORKOUT' | 'PR' | 'CALIBRATION_PR' | 'QUEST', sourceType: string, id: string, amount: number, explanation: Prisma.InputJsonObject) => {
        const counted = CAPPED_SOURCE.includes(sourceType);
        let granted = amount;
        let capSteps: unknown[] = [];
        if (counted) {
          const caps = applyCaps(amount, await this.grantedOn(tx, w.userId, w.performedAt), await this.grantedInWeek(tx, w.userId, w.performedAt), config);
          granted = caps.granted;
          capSteps = caps.steps;
        }
        if (granted <= 0) return null;
        const res = await this.ledger.appendXp(
          tx,
          { userId: w.userId, amount: granted, reason, sourceType, sourceId: id, ruleSetVersion, effectiveAt: w.performedAt, explanation: { ...explanation, workoutId: w.id, requested: amount, caps: capSteps as Prisma.InputJsonArray, result: granted } },
          levels,
        );
        if (counted) await this.addGranted(tx, w.userId, w.performedAt, granted, 0);
        if (res.levelUp) {
          await tx.activityEvent.create({ data: { id: uuidv7(), userId: w.userId, type: 'LEVEL_UP', refType: 'xp_transaction', refId: res.id, visibility: 'FRIENDS', payload: res.levelUp } });
        }
        return res.id;
      };

      // 1. Workout XP, with diminishing returns by number of workouts that day.
      const nth = await this.addGranted(tx, w.userId, w.performedAt, 0, 1);
      const base = workoutXp(w.durationS, config);
      const multiplier = diminishingMultiplier(nth, config);
      const workoutAmount = Math.floor(base.amount * multiplier);
      await grant('WORKOUT', 'workout', sourceId, workoutAmount, {
        formula: 'workout_xp',
        inputs: { durationMin: Math.floor(w.durationS / 60), workoutOfDay: nth },
        steps: [...base.steps, { label: 'diminishing_multiplier', value: multiplier }] as unknown as Prisma.InputJsonArray,
      });

      // 2. One PR reward per exercise per workout, with a per-metric cooldown.
      for (const pr of await this.rewardablePrs(tx, w.userId, prs, config.pr_same_metric_cooldown_days, w.performedAt)) {
        const calibration = pr.status === 'CALIBRATION';
        const amount = calibration ? config.calibration_pr_xp : prXp(pr.ratio ?? 0, config);
        const xpId = await grant(calibration ? 'CALIBRATION_PR' : 'PR', 'pr', pr.prId, amount, {
          formula: calibration ? 'calibration_pr_xp' : 'pr_xp',
          inputs: { exerciseId: pr.exerciseId, metric: pr.metricCode, value: pr.value, previous: pr.previousValue, ratio: pr.ratio },
        });
        if (xpId) await tx.personalRecord.update({ where: { id: pr.prId }, data: { xpTransactionId: xpId } });
      }

      // 3. Goal milestones reached by this workout (records held for review don't count).
      await this.goals.onWorkoutScored(tx, {
        userId: w.userId,
        workoutId: w.id,
        performedAt: w.performedAt,
        observations,
        skipExercises: new Set(prs.filter((p) => p.status === 'HELD').map((p) => p.exerciseId)),
        ruleSetVersion,
        config,
      });

      // 4. First quest: "Complete your first workout" → +100 XP + First Step badge (docs §6).
      const firstQuest = await tx.xpTransaction.findFirst({ where: { userId: w.userId, reason: 'QUEST', sourceId: 'FIRST_WORKOUT' } });
      if (!firstQuest) {
        await grant('QUEST', 'quest', 'FIRST_WORKOUT', config.first_workout_quest_xp, { formula: 'first_workout_quest_xp' });
        const badge = await tx.badge.findUnique({ where: { code: 'FIRST_STEP' } });
        if (badge) {
          const ub = await tx.userBadge.upsert({
            where: { userId_badgeId: { userId: w.userId, badgeId: badge.id } },
            update: {},
            create: { id: uuidv7(), userId: w.userId, badgeId: badge.id, sourceRef: w.id },
          });
          await tx.activityEvent.create({ data: { id: uuidv7(), userId: w.userId, type: 'BADGE', refType: 'user_badge', refId: ub.id, visibility: 'FRIENDS', payload: { badge: 'FIRST_STEP' } } });
        }
      }
    });
  }

  /**
   * Edit or delete: reverse every XP entry the workout produced and revoke its records.
   * An edited workout that is still accepted is then scored again as a new version.
   */
  async onChanged(workoutId: string): Promise<void> {
    const { version: ruleSetVersion, config } = await this.ruleSets.getActive();
    await this.prisma.$transaction(async (tx) => {
      const w = await tx.workout.findUniqueOrThrow({ where: { id: workoutId } });
      const prs = await this.progress.revokeWorkout(tx, workoutId);
      await this.goals.onWorkoutRevoked(tx, workoutId, ruleSetVersion, config);
      const entries = await tx.xpTransaction.findMany({
        where: {
          userId: w.userId,
          reversal: null,
          reason: { not: 'REVERSAL' },
          OR: [{ sourceType: 'workout', sourceId: { startsWith: `${workoutId}#` } }, { sourceType: 'pr', sourceId: { in: prs.map((p) => p.id) } }],
        },
      });
      let reversed = 0;
      for (const e of entries) {
        if (await this.ledger.reverseXp(tx, e.id, 'workout edited or deleted', ruleSetVersion, config)) reversed += e.amount;
      }
      const hadWorkoutXp = entries.some((e) => e.sourceType === 'workout');
      if (reversed || hadWorkoutXp) await this.addGranted(tx, w.userId, w.performedAt, -reversed, hadWorkoutXp ? -1 : 0);
      await tx.activityEvent.deleteMany({ where: { refId: { in: [workoutId, ...prs.map((p) => p.id)] } } });
    });
    const w = await this.prisma.workout.findUniqueOrThrow({ where: { id: workoutId } });
    if (w.status === 'ACCEPTED' && !w.deletedAt) await this.onAccepted(workoutId);
  }

  private async rewardablePrs(tx: Tx, userId: string, prs: PrOutcome[], cooldownDays: number, at: Date): Promise<PrOutcome[]> {
    const byExercise = new Map<string, PrOutcome>();
    // One implausible record on an exercise puts every record of that exercise in this workout on hold.
    const heldExercises = new Set(prs.filter((p) => p.status === 'HELD').map((p) => p.exerciseId));
    for (const pr of prs) {
      if (heldExercises.has(pr.exerciseId)) continue;
      if ((pr.status !== 'AWARDED' && pr.status !== 'CALIBRATION') || !XP_METRICS.has(pr.metricCode)) continue;
      const cur = byExercise.get(pr.exerciseId);
      const rank = (p: PrOutcome) => PR_PRIORITY.indexOf(p.metricCode);
      if (!cur || rank(pr) < rank(cur)) byExercise.set(pr.exerciseId, pr);
    }
    const out: PrOutcome[] = [];
    for (const pr of byExercise.values()) {
      const recent = await tx.personalRecord.findFirst({
        where: {
          userId,
          exerciseId: pr.exerciseId,
          metricType: { code: pr.metricCode },
          xpTransactionId: { not: null },
          status: pr.status,
          achievedAt: { gte: new Date(at.getTime() - cooldownDays * 86_400_000) },
          id: { not: pr.prId },
        },
      });
      if (!recent) out.push(pr);
    }
    return out;
  }

  /**
   * Daily streak with planned rest (docs §5 safety): gaps of up to `streakFreezeDaysPerWeek` rest days keep the
   * streak alive and count as streak days, so the streak never pushes anyone to train every single day.
   */
  private async updateDailyStreak(tx: Tx, userId: string, performedAt: Date): Promise<void> {
    const [streak, settings] = await Promise.all([tx.streak.findUnique({ where: { userId } }), tx.userSettings.findUnique({ where: { userId } })]);
    const day = this.day(performedAt);
    const last = streak?.lastTrainingDate ?? null;
    let current = streak?.currentDays ?? 0;
    if (!last) current = 1;
    else {
      const gap = Math.round((day.getTime() - last.getTime()) / 86_400_000);
      if (gap <= 0) return; // same day, or a back-dated workout: the streak is about going forward
      current = gap <= 1 + (settings?.streakFreezeDaysPerWeek ?? 2) ? current + gap : 1;
    }
    await tx.streak.upsert({
      where: { userId },
      update: { currentDays: current, longestDays: Math.max(current, streak?.longestDays ?? 0), lastTrainingDate: day },
      create: { userId, currentDays: current, longestDays: current, lastTrainingDate: day },
    });
  }

  private day(at: Date): Date {
    return new Date(`${this.calendar.localDate(at)}T00:00:00Z`);
  }

  /** Adds to the per-day counters (row-locked) and returns the updated workout count. */
  private async addGranted(tx: Tx, userId: string, at: Date, xp: number, workouts: number): Promise<number> {
    const day = this.day(at);
    const row = await tx.xpDailyCounter.upsert({
      where: { userId_day: { userId, day } },
      update: { xpGranted: { increment: xp }, workoutsCounted: { increment: workouts } },
      create: { userId, day, xpGranted: Math.max(0, xp), workoutsCounted: Math.max(0, workouts) },
    });
    return row.workoutsCounted;
  }

  private async grantedOn(tx: Tx, userId: string, at: Date): Promise<number> {
    const row = await tx.xpDailyCounter.findUnique({ where: { userId_day: { userId, day: this.day(at) } } });
    return row?.xpGranted ?? 0;
  }

  private async grantedInWeek(tx: Tx, userId: string, at: Date): Promise<number> {
    const weekStart = this.day(this.calendar.weekStart(at));
    const agg = await tx.xpDailyCounter.aggregate({
      where: { userId, day: { gte: weekStart, lt: new Date(weekStart.getTime() + 7 * 86_400_000) } },
      _sum: { xpGranted: true },
    });
    return agg._sum.xpGranted ?? 0;
  }
}
