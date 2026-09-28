import { HttpStatus, Injectable } from '@nestjs/common';
import { GymWod, GymWodScore, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { CursorCodec } from '../../common/pagination/cursor';
import { toPage } from '../../common/pagination/page';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GymsService } from '../gyms/gyms.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateWorkoutDto } from '../workouts/dto/workout.dto';
import { WorkoutsService } from '../workouts/workouts.service';
import { CreateGymWodDto, ListGymWodsQueryDto, SubmitWodScoreDto, UpdateGymWodDto, WodLeaderboardQueryDto } from './dto/gym-wod.dto';
import { better, scoreValue, validateWindow } from './wod-ranking';

const WOD_INCLUDE = { sport: true, createdBy: { select: { id: true, username: true } } } satisfies Prisma.GymWodInclude;
type WodRow = Prisma.GymWodGetPayload<{ include: typeof WOD_INCLUDE }>;

/** Coach-made WODs of a gym (spec §4). Scores count for the gym board and plain workout XP, never PRs or national LP. */
@Injectable()
export class GymWodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gyms: GymsService,
    private readonly audit: AuditService,
    private readonly cursors: CursorCodec,
    private readonly clock: ClockService,
    private readonly workouts: WorkoutsService,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
  ) {}

  async create(user: AuthUser, gymId: string, dto: CreateGymWodDto) {
    await this.requireCoach(user, gymId);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.checkWindow(startsAt, endsAt);
    if (dto.sportId && !(await this.prisma.sport.findUnique({ where: { id: dto.sportId } }))) throw AppException.validation([{ field: 'sportId', code: 'UNKNOWN_SPORT' }]);
    const id = uuidv7();
    await this.prisma.$transaction(async (tx) => {
      await tx.gymWod.create({
        data: { id, gymId, createdById: user.id, title: dto.title.trim(), description: dto.description.trim(), scoreType: dto.scoreType, timeCapS: dto.timeCapS, startsAt, endsAt, sportId: dto.sportId, status: dto.status ?? 'PUBLISHED' },
      });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'GYM_WOD_CREATED', entityType: 'gym_wod', entityId: id, after: { gymId, title: dto.title } }, tx);
    });
    return this.get(user, gymId, id);
  }

  async update(user: AuthUser, gymId: string, wodId: string, dto: UpdateGymWodDto) {
    await this.requireCoach(user, gymId);
    const wod = await this.find(gymId, wodId);
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : wod.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : wod.endsAt;
    this.checkWindow(startsAt, endsAt);
    await this.prisma.$transaction(async (tx) => {
      await tx.gymWod.update({ where: { id: wod.id }, data: { title: dto.title?.trim(), description: dto.description?.trim(), timeCapS: dto.timeCapS, startsAt, endsAt, status: dto.status } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'GYM_WOD_UPDATED', entityType: 'gym_wod', entityId: wod.id, before: { title: wod.title, status: wod.status }, after: { title: dto.title ?? wod.title, status: dto.status ?? wod.status } }, tx);
    });
    return this.get(user, gymId, wodId);
  }

  async list(user: AuthUser, gymId: string, q: ListGymWodsQueryDto) {
    const coach = await this.requireMemberOrCoach(user, gymId);
    const now = this.clock.now();
    const c = q.cursor ? this.cursors.decode<{ t: string; id: string }>(q.cursor) : null;
    const time: Prisma.GymWodWhereInput =
      q.when === 'active' ? { startsAt: { lte: now }, endsAt: { gt: now } } : q.when === 'upcoming' ? { startsAt: { gt: now } } : { endsAt: { lte: now } };
    const desc = q.when === 'past';
    const after: Prisma.GymWodWhereInput | undefined = c
      ? desc
        ? { OR: [{ endsAt: { lt: new Date(c.t) } }, { endsAt: new Date(c.t), id: { lt: c.id } }] }
        : { OR: [{ endsAt: { gt: new Date(c.t) } }, { endsAt: new Date(c.t), id: { gt: c.id } }] }
      : undefined;
    const rows = await this.prisma.gymWod.findMany({
      where: { AND: [{ gymId, status: coach ? { in: ['DRAFT', 'PUBLISHED'] } : 'PUBLISHED' }, time, ...(after ? [after] : [])] },
      include: WOD_INCLUDE,
      orderBy: desc ? [{ endsAt: 'desc' }, { id: 'desc' }] : [{ endsAt: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
    });
    const page = toPage(rows, q.limit, (w) => ({ t: w.endsAt.toISOString(), id: w.id }), (k) => this.cursors.encode(k));
    const mine = await this.myScores(user.id, page.data.map((w) => w.id));
    return { data: page.data.map((w) => this.view(w, mine.get(w.id) ?? null, now)), page: page.page };
  }

  async get(user: AuthUser, gymId: string, wodId: string) {
    const coach = await this.requireMemberOrCoach(user, gymId);
    const wod = await this.prisma.gymWod.findFirst({ where: { id: wodId, gymId }, include: WOD_INCLUDE });
    if (!wod || (!coach && wod.status !== 'PUBLISHED')) throw AppException.notFound('WOD');
    const mine = await this.myScores(user.id, [wod.id]);
    return this.view(wod, mine.get(wod.id) ?? null, this.clock.now());
  }

  // ───────────── Scores ─────────────

  /**
   * Records a member's score. Every submission is also logged as a GYM_WOD workout (plain workout XP through the
   * normal pipeline, no metric observations so no PRs or national LP). The board keeps the member's best score.
   */
  async submit(user: AuthUser, gymId: string, wodId: string, dto: SubmitWodScoreDto) {
    // Scores come from the gym's approved members (coaches and the owner are members too), never from outside staff.
    if (!(await this.gyms.approvedMember(user.id, gymId))) throw AppException.forbidden('Only members of this gym can submit scores.');
    const wod = await this.find(gymId, wodId);
    const now = this.clock.now();
    if (wod.status !== 'PUBLISHED' || now < wod.startsAt || now >= wod.endsAt) throw AppException.conflict(ErrorCode.WOD_CLOSED, 'This WOD is not open for scores.');
    const value = scoreValue(wod.scoreType, dto);
    if (value === null) {
      throw AppException.validation([{ field: wod.scoreType === 'FOR_TIME' ? 'timeS' : wod.scoreType === 'AMRAP' ? 'reps' : 'loadKg', code: 'REQUIRED' }]);
    }
    if (wod.scoreType === 'FOR_TIME' && wod.timeCapS && value > wod.timeCapS) throw AppException.validation([{ field: 'timeS', code: 'OVER_TIME_CAP' }]);

    const durationS = Math.max(60, wod.scoreType === 'FOR_TIME' ? value : (wod.timeCapS ?? 20 * 60));
    const sportId = wod.sportId ?? (await this.prisma.sport.findUniqueOrThrow({ where: { code: 'CROSSFIT' } })).id;
    const { workout } = await this.workouts.create(user.id, {
      clientId: dto.clientId,
      sportId,
      workoutType: 'GYM_WOD',
      performedAt: dto.performedAt,
      durationS,
      notes: `${wod.title} (${dto.division}): ${dto.rounds != null ? `${dto.rounds} rounds, ` : ''}${value}${wod.scoreType === 'FOR_TIME' ? ' s' : wod.scoreType === 'MAX_LOAD' ? ' kg' : ' reps'}`,
      exercises: [],
    } as CreateWorkoutDto);
    if (workout.status === 'REJECTED') {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.WORKOUT_REJECTED, 'Workout rejected', { extra: { workout } });
    }

    const existing = await this.prisma.gymWodScore.findUnique({ where: { wodId_userId: { wodId, userId: user.id } } });
    const keepExisting = existing && existing.status === 'VALID' && existing.division === dto.division && !better(wod.scoreType, value, Number(existing.value));
    if (!keepExisting) {
      const data = { division: dto.division, value, rounds: dto.rounds ?? null, reps: dto.reps ?? null, workoutId: workout.id, status: 'VALID' as const, invalidatedById: null, invalidationReason: null };
      await this.prisma.gymWodScore.upsert({ where: { wodId_userId: { wodId, userId: user.id } }, update: data, create: { id: uuidv7(), wodId, userId: user.id, ...data } });
    }
    return this.get(user, gymId, wodId);
  }

  async leaderboard(user: AuthUser, gymId: string, wodId: string, q: WodLeaderboardQueryDto) {
    await this.requireMemberOrCoach(user, gymId);
    const wod = await this.find(gymId, wodId);
    const offset = q.cursor ? this.cursors.decode<{ o: number }>(q.cursor).o : 0;
    const rows = await this.prisma.gymWodScore.findMany({
      where: { wodId, division: q.division, status: 'VALID' },
      include: { user: { select: { id: true, username: true, profile: { select: { fullName: true } } } } },
      orderBy: [{ value: wod.scoreType === 'FOR_TIME' ? 'asc' : 'desc' }, { updatedAt: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: q.limit + 1,
    });
    const hasMore = rows.length > q.limit;
    const data = rows.slice(0, q.limit).map((s, i) => ({
      rank: offset + i + 1,
      scoreId: s.id,
      athlete: { id: s.user.id, username: s.user.username, fullName: s.user.profile?.fullName ?? null },
      value: Number(s.value),
      rounds: s.rounds,
      reps: s.reps,
      submittedAt: s.updatedAt.toISOString(),
    }));
    return { data, page: { nextCursor: hasMore ? this.cursors.encode({ o: offset + q.limit }) : null, hasMore } };
  }

  async leaderboardMe(user: AuthUser, gymId: string, wodId: string, division: 'RX' | 'SCALED') {
    await this.requireMemberOrCoach(user, gymId);
    const wod = await this.find(gymId, wodId);
    const mine = await this.prisma.gymWodScore.findUnique({ where: { wodId_userId: { wodId, userId: user.id } } });
    if (!mine || mine.status !== 'VALID' || mine.division !== division) return {};
    const ahead = await this.prisma.gymWodScore.count({
      where: {
        wodId,
        division,
        status: 'VALID',
        OR: [{ value: wod.scoreType === 'FOR_TIME' ? { lt: mine.value } : { gt: mine.value } }, { value: mine.value, updatedAt: { lt: mine.updatedAt } }],
      },
    });
    return { rank: ahead + 1, ...this.scoreView(mine) };
  }

  async invalidate(user: AuthUser, gymId: string, wodId: string, scoreId: string, reason: string) {
    await this.requireCoach(user, gymId);
    const wod = await this.find(gymId, wodId);
    const score = await this.prisma.gymWodScore.findFirst({ where: { id: scoreId, wodId } });
    if (!score || score.status !== 'VALID') throw AppException.notFound('Score');
    await this.prisma.$transaction(async (tx) => {
      await tx.gymWodScore.update({ where: { id: score.id }, data: { status: 'INVALIDATED', invalidatedById: user.id, invalidationReason: reason } });
      // Soft-delete the linked workout in the same transaction; its XP is reversed by the WorkoutDeleted pipeline.
      // Already deleted by the member: nothing to reverse, the invalidation still succeeds.
      const workout = await tx.workout.findUnique({ where: { id: score.workoutId } });
      const removed = await tx.workout.updateMany({ where: { id: score.workoutId, deletedAt: null }, data: { deletedAt: this.clock.now() } });
      if (removed.count && workout) await this.outbox.enqueue(tx, 'WorkoutDeleted', { workoutId: workout.id, userId: workout.userId, previousStatus: workout.status });
      await this.notifications.notify(tx, score.userId, 'GYM_WOD_SCORE_INVALIDATED', { gymId, wodId, wodTitle: wod.title, reason });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'GYM_WOD_SCORE_INVALIDATED', entityType: 'gym_wod_score', entityId: score.id, after: { reason } }, tx);
    });
    return { id: score.id, status: 'INVALIDATED' };
  }

  // ───────────── Internals ─────────────

  protected async find(gymId: string, wodId: string): Promise<GymWod> {
    const wod = await this.prisma.gymWod.findFirst({ where: { id: wodId, gymId } });
    if (!wod) throw AppException.notFound('WOD');
    return wod;
  }

  protected async requireCoach(user: AuthUser, gymId: string): Promise<void> {
    if (!(await this.gyms.isCoach(user, gymId))) throw AppException.forbidden('Only a coach of this gym can do that.');
  }

  /** True for coaches; throws for non-members. */
  protected async requireMemberOrCoach(user: AuthUser, gymId: string): Promise<boolean> {
    if (await this.gyms.isCoach(user, gymId)) return true;
    if (!(await this.gyms.approvedMember(user.id, gymId))) throw AppException.forbidden('Only members of this gym can see its WODs.');
    return false;
  }

  private checkWindow(startsAt: Date, endsAt: Date): void {
    const err = validateWindow(startsAt, endsAt);
    if (err) throw AppException.validation([{ field: 'endsAt', code: err }]);
  }

  private async myScores(userId: string, wodIds: string[]): Promise<Map<string, GymWodScore>> {
    const rows = await this.prisma.gymWodScore.findMany({ where: { userId, wodId: { in: wodIds } } });
    return new Map(rows.map((s) => [s.wodId, s]));
  }

  protected scoreView(s: GymWodScore) {
    return { id: s.id, division: s.division, value: Number(s.value), rounds: s.rounds, reps: s.reps, status: s.status, invalidationReason: s.invalidationReason };
  }

  private view(w: WodRow, mine: GymWodScore | null, now: Date) {
    return {
      id: w.id,
      gymId: w.gymId,
      title: w.title,
      description: w.description,
      scoreType: w.scoreType,
      timeCapS: w.timeCapS,
      startsAt: w.startsAt.toISOString(),
      endsAt: w.endsAt.toISOString(),
      status: w.status,
      sport: w.sport ? { code: w.sport.code, name: w.sport.nameI18n } : null,
      createdBy: w.createdBy,
      isOpen: w.status === 'PUBLISHED' && w.startsAt <= now && now < w.endsAt,
      myScore: mine ? this.scoreView(mine) : null,
    };
  }
}
