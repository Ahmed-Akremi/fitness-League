import { HttpStatus, Injectable } from '@nestjs/common';
import { Exercise, Prisma, Sport, Visibility, WorkoutStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { OutboxService } from '../../common/outbox/outbox.service';
import { CursorCodec } from '../../common/pagination/cursor';
import { Page, toPage } from '../../common/pagination/page';
import { PrismaService } from '../../common/prisma/prisma.service';
import { evaluateWorkout, Evaluation, OVERLAP_TOLERANCE_MS, Plausibility, RuleHit } from '../anticheat/rules';
import { RuleSetService } from '../scoring/rule-set.service';
import { SocialAccess } from '../social/social-access';
import { PrivacyService } from '../users/privacy.service';
import { CreateWorkoutDto, ListWorkoutsQueryDto, WorkoutContentDto } from './dto/workout.dto';
import { canonicalHash, estimate1rm, fingerprint, totalDistanceM, totalVolumeKg, WorkoutInput } from './workout-metrics';

const EDIT_WINDOW_MS = 24 * 3600_000;

const fullInclude = {
  exercises: { orderBy: { position: 'asc' }, include: { sets: { orderBy: { setIndex: 'asc' } } } },
  evaluation: true,
} satisfies Prisma.WorkoutInclude;
type FullWorkout = Prisma.WorkoutGetPayload<{ include: typeof fullInclude }>;

export type CreateResult = { kind: 'CREATED' | 'REPLAYED'; workout: WorkoutView };
export type WorkoutView = ReturnType<WorkoutsService['toView']>;

@Injectable()
export class WorkoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleSets: RuleSetService,
    private readonly privacy: PrivacyService,
    private readonly social: SocialAccess,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
    private readonly cursors: CursorCodec,
  ) {}

  // ───────────────────────────── Create (idempotent) ─────────────────────────────

  async create(userId: string, dto: CreateWorkoutDto): Promise<CreateResult> {
    const { deviceSubmittedAt, ...content } = dto;
    const payloadHash = canonicalHash(content);

    const existing = await this.prisma.workout.findUnique({ where: { userId_clientId: { userId, clientId: dto.clientId } }, include: fullInclude });
    if (existing) return this.replay(existing, payloadHash, userId);

    const input = await this.toInput(dto);
    const evaluation = await this.evaluate(userId, input, deviceSubmittedAt ? new Date(deviceSubmittedAt) : null);
    const settings = await this.prisma.userSettings.findUnique({ where: { userId } });
    const workoutId = uuidv7();

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await tx.workout.create({
          data: {
            id: workoutId,
            userId,
            clientId: dto.clientId,
            payloadHash,
            deviceSubmittedAt: deviceSubmittedAt ? new Date(deviceSubmittedAt) : null,
            receivedAt: this.clock.now(),
            visibility: dto.visibility ?? settings?.defaultVisibility ?? Visibility.FRIENDS,
            ...this.contentData(input, dto, evaluation),
          },
        });
        await this.writeExercises(tx, workoutId, input, dto);
        await this.writeEvaluation(tx, workoutId, evaluation);
        if (evaluation.outcome === 'ACCEPTED') {
          await this.outbox.enqueue(tx, 'WorkoutAccepted', { workoutId, userId, countsForCompetition: evaluation.countsForCompetition });
        }
        return tx.workout.findUniqueOrThrow({ where: { id: workoutId }, include: fullInclude });
      });
      return { kind: 'CREATED', workout: this.toView(created, true) };
    } catch (err) {
      // Two concurrent submissions of the same offline workout: the loser replays the winner.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.workout.findUniqueOrThrow({ where: { userId_clientId: { userId, clientId: dto.clientId } }, include: fullInclude });
        return this.replay(winner, payloadHash, userId);
      }
      throw err;
    }
  }

  private replay(existing: FullWorkout, payloadHash: Buffer, userId: string): CreateResult {
    if (Buffer.from(existing.payloadHash).equals(payloadHash)) return { kind: 'REPLAYED', workout: this.toView(existing, existing.userId === userId) };
    throw AppException.conflict(ErrorCode.IDEMPOTENCY_CONFLICT, 'A workout with this clientId was already synced with different data.', {
      workout: this.toView(existing, true),
    });
  }

  // ───────────────────────────── Update / delete ─────────────────────────────

  async update(userId: string, id: string, dto: WorkoutContentDto, ifMatch: string | undefined): Promise<WorkoutView> {
    const current = await this.ownedOrThrow(userId, id);
    const expected = Number(String(ifMatch ?? '').replace(/^W\//, '').replace(/"/g, ''));
    if (!ifMatch || !Number.isInteger(expected)) throw AppException.validation([{ field: 'If-Match', code: 'REQUIRED' }]);
    if (current.receivedAt.getTime() + EDIT_WINDOW_MS < this.clock.now().getTime()) {
      throw AppException.conflict(ErrorCode.EDIT_WINDOW_CLOSED, 'Workouts can be edited for 24 hours after they are logged.');
    }
    if (expected !== current.version) {
      throw new AppException(HttpStatus.PRECONDITION_FAILED, ErrorCode.VERSION_CONFLICT, 'Version conflict', {
        extra: { workout: this.toView(await this.full(id), true) },
      });
    }

    const input = await this.toInput(dto);
    const evaluation = await this.evaluate(userId, input, null, id);
    const updated = await this.prisma.$transaction(async (tx) => {
      // Conditional on the version so two concurrent edits cannot both win.
      const { count } = await tx.workout.updateMany({
        where: { id, version: current.version },
        data: { version: { increment: 1 }, visibility: dto.visibility ?? current.visibility, ...this.contentData(input, dto, evaluation) },
      });
      if (count !== 1) throw new AppException(HttpStatus.PRECONDITION_FAILED, ErrorCode.VERSION_CONFLICT, 'Version conflict');
      await tx.workoutExercise.deleteMany({ where: { workoutId: id } });
      await tx.workoutEvaluation.delete({ where: { workoutId: id } });
      await this.writeExercises(tx, id, input, dto);
      await this.writeEvaluation(tx, id, evaluation);
      await this.outbox.enqueue(tx, 'WorkoutUpdated', { workoutId: id, userId, previousStatus: current.status, version: current.version + 1 });
      return tx.workout.findUniqueOrThrow({ where: { id }, include: fullInclude });
    });
    return this.toView(updated, true);
  }

  async remove(userId: string, id: string): Promise<void> {
    const current = await this.ownedOrThrow(userId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.workout.update({ where: { id }, data: { deletedAt: this.clock.now() } });
      await this.outbox.enqueue(tx, 'WorkoutDeleted', { workoutId: id, userId, previousStatus: current.status });
    });
  }

  // ───────────────────────────── Read ─────────────────────────────

  async get(viewerId: string, id: string): Promise<WorkoutView> {
    const w = await this.prisma.workout.findUnique({ where: { id }, include: fullInclude });
    if (!w || w.deletedAt) throw AppException.notFound('Workout');
    if (w.userId === viewerId) return this.toView(w, true);
    // Others only ever see accepted workouts they are allowed to see; anything else is indistinguishable from 404.
    if (w.status !== 'ACCEPTED' || !(await this.social.canView(viewerId, w.userId, w.visibility))) throw AppException.notFound('Workout');
    return this.toView(w, false);
  }

  async list(userId: string, q: ListWorkoutsQueryDto): Promise<Page<WorkoutView>> {
    const where: Prisma.WorkoutWhereInput = { userId, deletedAt: null, sportId: q.sportId };
    if (q.from || q.to) where.performedAt = { gte: q.from ? new Date(q.from) : undefined, lt: q.to ? new Date(q.to) : undefined };
    if (q.cursor) {
      const c = this.cursors.decode<{ p: string; id: string }>(q.cursor);
      where.AND = [{ OR: [{ performedAt: { lt: new Date(c.p) } }, { performedAt: new Date(c.p), id: { lt: c.id } }] }];
    }
    const rows = await this.prisma.workout.findMany({ where, include: fullInclude, orderBy: [{ performedAt: 'desc' }, { id: 'desc' }], take: q.limit + 1 });
    const page = toPage(rows, q.limit, (w) => ({ p: w.performedAt.toISOString(), id: w.id }), (k) => this.cursors.encode(k));
    return { data: page.data.map((w) => this.toView(w, true)), page: page.page };
  }

  // ───────────────────────────── Moderation of held workouts ─────────────────────────────

  async listHeld(limit: number, cursor?: string): Promise<Page<WorkoutView & { userId: string }>> {
    const where: Prisma.WorkoutWhereInput = { status: 'HELD_FOR_REVIEW', deletedAt: null };
    if (cursor) {
      const c = this.cursors.decode<{ r: string; id: string }>(cursor);
      where.OR = [{ receivedAt: { gt: new Date(c.r) } }, { receivedAt: new Date(c.r), id: { gt: c.id } }];
    }
    const rows = await this.prisma.workout.findMany({ where, include: fullInclude, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }], take: limit + 1 });
    const page = toPage(rows, limit, (w) => ({ r: w.receivedAt.toISOString(), id: w.id }), (k) => this.cursors.encode(k));
    return { data: page.data.map((w) => ({ ...this.toView(w, true), userId: w.userId })), page: page.page };
  }

  async review(moderatorId: string, id: string, decision: 'APPROVE' | 'REJECT', note: string): Promise<WorkoutView> {
    const w = await this.prisma.workout.findUnique({ where: { id }, include: fullInclude });
    if (!w || w.deletedAt || w.status !== 'HELD_FOR_REVIEW') throw AppException.notFound('Held workout');
    const status: WorkoutStatus = decision === 'APPROVE' ? 'ACCEPTED' : 'REJECTED';
    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.workout.updateMany({ where: { id, status: 'HELD_FOR_REVIEW' }, data: { status } });
      if (count !== 1) throw AppException.conflict(ErrorCode.CONFLICT, 'Already reviewed');
      await tx.workoutEvaluation.update({ where: { workoutId: id }, data: { reviewedById: moderatorId, reviewedAt: this.clock.now(), reviewNote: note } });
      if (status === 'ACCEPTED') {
        const hits = (w.evaluation?.ruleHits ?? []) as unknown as RuleHit[];
        await this.outbox.enqueue(tx, 'WorkoutAccepted', { workoutId: id, userId: w.userId, countsForCompetition: !hits.some((h) => h.rule === 'LATE_LOG'), afterReview: true });
      }
      await this.audit.log(
        { actorId: moderatorId, action: decision === 'APPROVE' ? 'WORKOUT_APPROVED' : 'WORKOUT_REJECTED', entityType: 'workout', entityId: id, before: { status: w.status }, after: { status, note } },
        tx,
      );
      return tx.workout.findUniqueOrThrow({ where: { id }, include: fullInclude });
    });
    return this.toView(updated, true);
  }

  // ───────────────────────────── Internals ─────────────────────────────

  private async ownedOrThrow(userId: string, id: string) {
    const w = await this.prisma.workout.findUnique({ where: { id } });
    if (!w || w.deletedAt || w.userId !== userId) throw AppException.notFound('Workout');
    return w;
  }

  private full(id: string): Promise<FullWorkout> {
    return this.prisma.workout.findUniqueOrThrow({ where: { id }, include: fullInclude });
  }

  /** Validates sport/exercise consistency and set shapes, and resolves exercise codes. */
  private async toInput(dto: WorkoutContentDto): Promise<WorkoutInput & { sport: Sport; catalog: Map<string, Exercise> }> {
    const sport = await this.prisma.sport.findUnique({ where: { id: dto.sportId } });
    if (!sport || !sport.enabled) throw AppException.validation([{ field: 'sportId', code: 'UNKNOWN_SPORT' }]);
    const ids = [...new Set(dto.exercises.map((e) => e.exerciseId))];
    const catalog = new Map((await this.prisma.exercise.findMany({ where: { id: { in: ids } } })).map((e) => [e.id, e]));

    const exercises = dto.exercises.map((ex, i) => {
      const e = catalog.get(ex.exerciseId);
      if (!e || !e.enabled) throw AppException.validation([{ field: `exercises[${i}].exerciseId`, code: 'UNKNOWN_EXERCISE' }]);
      const sharedOk = e.sportId === null && sport.category !== 'CARDIO';
      if (e.sportId !== sport.id && !sharedOk) throw AppException.validation([{ field: `exercises[${i}].exerciseId`, code: 'EXERCISE_NOT_IN_SPORT' }]);
      const cardio = e.trackedMetrics.includes('DISTANCE');
      ex.sets.forEach((s, j) => {
        const ok = cardio ? s.distanceM != null || s.durationS != null : s.reps != null || s.durationS != null;
        if (!ok) throw AppException.validation([{ field: `exercises[${i}].sets[${j}]`, code: cardio ? 'DISTANCE_OR_DURATION_REQUIRED' : 'REPS_OR_DURATION_REQUIRED' }]);
        if (!e.isBodyweight && !cardio && s.reps != null && s.weightKg == null) {
          throw AppException.validation([{ field: `exercises[${i}].sets[${j}].weightKg`, code: 'REQUIRED' }]);
        }
      });
      return { exerciseId: e.id, exerciseCode: e.code, isBodyweight: e.isBodyweight, sets: ex.sets };
    });

    return { sport, catalog, sportId: sport.id, workoutType: dto.workoutType, performedAt: new Date(dto.performedAt), durationS: dto.durationS, note: dto.notes ?? null, exercises };
  }

  private async evaluate(userId: string, input: WorkoutInput & { catalog: Map<string, Exercise> }, deviceSubmittedAt: Date | null, selfId?: string): Promise<Evaluation & { ruleSetVersion: number; fingerprint: Buffer }> {
    const { version, config } = await this.ruleSets.getActive();
    const now = this.clock.now();
    const fp = fingerprint(input);
    const start = input.performedAt;
    const end = new Date(start.getTime() + input.durationS * 1000);
    const dayStart = this.calendar.dayStart(start);
    const live: Prisma.WorkoutWhereInput = { userId, deletedAt: null, status: { not: 'REJECTED' }, ...(selfId && { id: { not: selfId } }) };

    const [sameDay, nearby, identicalRecent, bodyWeightKg] = await Promise.all([
      this.prisma.workout.count({ where: { ...live, performedAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) } } }),
      this.prisma.workout.findMany({
        where: { ...live, performedAt: { gte: new Date(start.getTime() - 86_400_000), lt: end } },
        select: { performedAt: true, durationS: true, fingerprint: true },
      }),
      this.prisma.workout.count({
        where: { ...live, fingerprint: fp, performedAt: { gte: new Date(now.getTime() - config.anticheat.identical_fingerprint_hold.days * 86_400_000) } },
      }),
      this.privacy.latestWeightKg(userId),
    ]);
    const overlapping = nearby
      .filter((o) => {
        const oStart = o.performedAt.getTime();
        const oEnd = oStart + o.durationS * 1000;
        return oStart < end.getTime() - OVERLAP_TOLERANCE_MS && oEnd > start.getTime() + OVERLAP_TOLERANCE_MS;
      })
      .map((o) => ({ fingerprintHex: o.fingerprint ? Buffer.from(o.fingerprint).toString('hex') : '' }));

    const evaluation = evaluateWorkout(
      input,
      { now, deviceSubmittedAt, bodyWeightKg, workoutsSameDay: sameDay, overlapping, identicalRecent, fingerprintHex: fp.toString('hex') },
      config,
      (code) => {
        const ex = [...input.catalog.values()].find((e) => e.code === code);
        return (ex?.plausibility ?? {}) as Plausibility;
      },
    );
    return { ...evaluation, ruleSetVersion: version, fingerprint: fp };
  }

  private contentData(input: WorkoutInput, dto: WorkoutContentDto, e: Evaluation & { ruleSetVersion: number; fingerprint: Buffer }) {
    const status: WorkoutStatus = e.outcome;
    return {
      sportId: input.sportId,
      workoutType: dto.workoutType,
      performedAt: input.performedAt,
      durationS: input.durationS,
      notes: dto.notes ?? null,
      status,
      totalVolumeKg: totalVolumeKg(input),
      totalDistanceM: totalDistanceM(input),
      fingerprint: e.fingerprint,
    };
  }

  private async writeEvaluation(tx: Prisma.TransactionClient, workoutId: string, e: Evaluation & { ruleSetVersion: number }): Promise<void> {
    await tx.workoutEvaluation.create({
      data: {
        workoutId,
        outcome: e.outcome,
        ruleHits: e.hits as unknown as Prisma.InputJsonValue,
        confidence: e.confidence,
        ruleSetVersion: e.ruleSetVersion,
      },
    });
  }

  private async writeExercises(tx: Prisma.TransactionClient, workoutId: string, input: WorkoutInput, dto: WorkoutContentDto): Promise<void> {
    const { config } = await this.ruleSets.getActive();
    for (const [position, ex] of input.exercises.entries()) {
      const exerciseRowId = uuidv7();
      await tx.workoutExercise.create({ data: { id: exerciseRowId, workoutId, exerciseId: ex.exerciseId, position, notes: dto.exercises[position]?.notes ?? null } });
      await tx.workoutSet.createMany({
        data: ex.sets.map((s, setIndex) => ({
          id: uuidv7(),
          workoutExerciseId: exerciseRowId,
          setIndex,
          reps: s.reps ?? null,
          weightKg: s.weightKg ?? null,
          distanceM: s.distanceM ?? null,
          durationS: s.durationS ?? null,
          isWarmup: s.isWarmup ?? false,
          rpe: s.rpe ?? null,
          e1rmKg: !s.isWarmup && s.weightKg && s.reps ? estimate1rm(s.weightKg, s.reps, config.e1rm_formula, config.e1rm_max_reps) : null,
        })),
      });
    }
  }

  /** `withEvaluation` is true only for the owner (and moderators): rule details are never public. */
  toView(w: FullWorkout, withEvaluation: boolean) {
    const hits = (w.evaluation?.ruleHits ?? []) as unknown as RuleHit[];
    return {
      id: w.id,
      clientId: w.clientId,
      sportId: w.sportId,
      workoutType: w.workoutType,
      performedAt: w.performedAt.toISOString(),
      durationS: w.durationS,
      notes: w.notes,
      visibility: w.visibility,
      status: w.status,
      isVerified: w.isVerified,
      version: w.version,
      totalVolumeKg: w.totalVolumeKg === null ? null : Number(w.totalVolumeKg),
      totalDistanceM: w.totalDistanceM,
      receivedAt: w.receivedAt.toISOString(),
      exercises: w.exercises.map((e) => ({
        id: e.id,
        exerciseId: e.exerciseId,
        position: e.position,
        notes: e.notes,
        sets: e.sets.map((s) => ({
          setIndex: s.setIndex,
          reps: s.reps,
          weightKg: s.weightKg === null ? null : Number(s.weightKg),
          distanceM: s.distanceM,
          durationS: s.durationS,
          isWarmup: s.isWarmup,
          rpe: s.rpe === null ? null : Number(s.rpe),
          e1rmKg: s.e1rmKg === null ? null : Number(s.e1rmKg),
        })),
      })),
      evaluation:
        withEvaluation && w.evaluation
          ? {
              outcome: w.evaluation.outcome,
              ruleHits: hits,
              countsForCompetition: !hits.some((h) => h.rule === 'LATE_LOG'),
              reviewedAt: w.evaluation.reviewedAt?.toISOString() ?? null,
            }
          : undefined,
    };
  }
}
