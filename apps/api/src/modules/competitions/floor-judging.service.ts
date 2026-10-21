import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FloorScoreDto } from './competitions.dto';
import { MAX_REPS, rawValue, scoredMovements, type ScoreType } from './domain';
import { JudgingService } from './judging.service';

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v));

/** The raw keys a floor judge may send: the athlete form's shapes plus the floor extras (tie-break, no-reps). */
const RAW_KEYS = ['timeS', 'capped', 'reps', 'rounds', 'repsPerRound', 'movementReps', 'value', 'tieBreakS', 'noReps'] as const;

/**
 * Floor judging (spec 2026-10-21): on-site events, app users invited by the organizer judge one lane (one
 * athlete) per heat. Their score goes FINAL at once — the athlete confirms it on the judge's phone — in the same
 * transaction shape as the admin judges' decisions: version, leaderboard recomputed, audit, notification.
 * Admin judge accounts (JUDGE / HEAD_JUDGE) are not concerned: FLOOR_JUDGE is a role of its own.
 */
@Injectable()
export class FloorJudgingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly notifications: NotificationsService,
    private readonly judging: JudgingService,
  ) {}

  // ───────────── Invitations ─────────────

  /** My floor-judge invitations (pending) and the events I judge (accepted), soonest first. */
  async mine(user: AuthUser) {
    const rows = await this.prisma.competitionStaff.findMany({
      where: { userId: user.id, role: 'FLOOR_JUDGE', competition: { deletedAt: null } },
      include: {
        competition: { select: { id: true, title: true, status: true, eventStart: true, eventEnd: true, city: true, location: true } },
        _count: { select: { judgedLanes: true } },
      },
      orderBy: { competition: { eventStart: 'asc' } },
    });
    return rows.map((s) => ({ staffId: s.id, accepted: s.acceptedAt != null, acceptedAt: s.acceptedAt, lanes: s._count.judgedLanes, competition: s.competition }));
  }

  async accept(user: AuthUser, competitionId: string) {
    const staff = await this.invitation(user, competitionId);
    if (staff.acceptedAt) return { staffId: staff.id, acceptedAt: staff.acceptedAt };
    const acceptedAt = this.clock.now();
    await this.prisma.competitionStaff.update({ where: { id: staff.id }, data: { acceptedAt } });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.floor_judge.accepted', entityType: 'CompetitionStaff', entityId: staff.id });
    return { staffId: staff.id, acceptedAt };
  }

  /** Declining (or leaving later) removes the role; the lanes it judged lose their judge. */
  async decline(user: AuthUser, competitionId: string) {
    const staff = await this.invitation(user, competitionId);
    await this.prisma.competitionStaff.delete({ where: { id: staff.id } });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.floor_judge.declined', entityType: 'CompetitionStaff', entityId: staff.id, before: { acceptedAt: staff.acceptedAt } });
  }

  private async invitation(user: AuthUser, competitionId: string) {
    const staff = await this.prisma.competitionStaff.findFirst({ where: { competitionId, userId: user.id, role: 'FLOOR_JUDGE' } });
    if (!staff) throw AppException.notFound('Invitation');
    return staff;
  }

  // ───────────── Lanes (organizer) ─────────────

  /** Puts a floor judge on an occupied lane (or frees it). A judge holds one lane per heat and never their own. */
  async setLaneJudge(user: AuthUser, competitionId: string, heatId: string, lane: number, staffId: string | null) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    const row = await this.lane(competitionId, heatId, lane);
    if (staffId) {
      const staff = await this.prisma.competitionStaff.findFirst({ where: { id: staffId, competitionId, role: 'FLOOR_JUDGE' } });
      if (!staff) throw AppException.validation([{ field: 'staffId', code: 'NOT_A_FLOOR_JUDGE' }]);
      if (staff.userId === row.registration.userId) throw AppException.conflict(ErrorCode.CONFLICT, 'A judge never judges their own lane', { reason: 'OWN_LANE' });
      const busy = await this.prisma.competitionHeatLane.findFirst({ where: { heatId, judgeStaffId: staffId, NOT: { id: row.id } } });
      if (busy) throw AppException.conflict(ErrorCode.CONFLICT, 'This judge already has a lane in this heat', { reason: 'JUDGE_BUSY', lane: busy.lane });
    }
    await this.prisma.competitionHeatLane.update({ where: { id: row.id }, data: { judgeStaffId: staffId } });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.heat.lane_judge_set', entityType: 'CompetitionHeat', entityId: heatId, before: { lane, staffId: row.judgeStaffId }, after: { lane, staffId } });
    return { lane, staffId };
  }

  /** Gives every occupied lane without a judge one of the accepted judges still free in this heat, in invitation order. */
  async autoJudges(user: AuthUser, competitionId: string, heatId: string) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    const heat = await this.prisma.competitionHeat.findFirst({ where: { id: heatId, competitionId }, include: { lanes: { orderBy: { lane: 'asc' }, include: { registration: { select: { userId: true } } } } } });
    if (!heat) throw AppException.notFound('Heat');
    const judges = await this.prisma.competitionStaff.findMany({ where: { competitionId, role: 'FLOOR_JUDGE', acceptedAt: { not: null } }, orderBy: { createdAt: 'asc' } });
    const busy = new Set(heat.lanes.map((l) => l.judgeStaffId).filter((id): id is string => id != null));
    let assigned = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const l of heat.lanes) {
        if (l.judgeStaffId) continue;
        const judge = judges.find((j) => !busy.has(j.id) && j.userId !== l.registration.userId);
        if (!judge) continue;
        busy.add(judge.id);
        await tx.competitionHeatLane.update({ where: { id: l.id }, data: { judgeStaffId: judge.id } });
        assigned++;
      }
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.heat.judges_auto', entityType: 'CompetitionHeat', entityId: heatId, after: { assigned } }, tx);
    });
    return { assigned, withoutJudge: heat.lanes.filter((l) => !l.judgeStaffId).length - assigned };
  }

  // ───────────── Heat clock ─────────────

  /** Starts the heat's common clock once; later calls answer the first start. Organizers or a judge of the heat. */
  async start(user: AuthUser, competitionId: string, heatId: string) {
    const heat = await this.prisma.competitionHeat.findFirst({ where: { id: heatId, competitionId } });
    if (!heat) throw AppException.notFound('Heat');
    if (!(await this.isOrganizer(user, competitionId))) {
      const judges = await this.prisma.competitionHeatLane.count({ where: { heatId, judge: { userId: user.id, acceptedAt: { not: null } } } });
      if (judges === 0) throw AppException.forbidden('Organizers or the judges of this heat only');
    }
    const now = this.clock.now();
    const { count } = await this.prisma.competitionHeat.updateMany({ where: { id: heatId, startedAt: null }, data: { startedAt: now } });
    if (count) await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.heat.started', entityType: 'CompetitionHeat', entityId: heatId, after: { startedAt: now.toISOString() } });
    const after = await this.prisma.competitionHeat.findUniqueOrThrow({ where: { id: heatId }, select: { startedAt: true } });
    return { startedAt: after.startedAt, serverTime: now };
  }

  /** False start: the organizer clears the clock; the next start sets it again. */
  async resetStart(user: AuthUser, competitionId: string, heatId: string) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    const heat = await this.prisma.competitionHeat.findFirst({ where: { id: heatId, competitionId } });
    if (!heat) throw AppException.notFound('Heat');
    await this.prisma.competitionHeat.update({ where: { id: heatId }, data: { startedAt: null } });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.heat.start_reset', entityType: 'CompetitionHeat', entityId: heatId, before: { startedAt: heat.startedAt?.toISOString() ?? null } });
  }

  // ───────────── Judge's lanes and scores ─────────────

  /** Everything an accepted floor judge needs, lane by lane: heat and its clock, WOD (the category's version), athlete, score sent. */
  async myLanes(user: AuthUser, competitionId: string) {
    const staff = await this.prisma.competitionStaff.findFirst({ where: { competitionId, userId: user.id, role: 'FLOOR_JUDGE', acceptedAt: { not: null } } });
    if (!staff) throw AppException.forbidden('Floor judges only');
    const competition = await this.prisma.competition.findFirst({ where: { id: competitionId, deletedAt: null }, select: { id: true, title: true, leaderboardLockedAt: true } });
    if (!competition) throw AppException.notFound('Competition');
    const lanes = await this.prisma.competitionHeatLane.findMany({
      where: { judgeStaffId: staff.id },
      include: {
        heat: { include: { workout: { include: { variants: true } } } },
        registration: { select: { userId: true, category: { select: { id: true, name: true } } } },
      },
    });
    const names = await this.judging.names(lanes.map((l) => l.registration.userId));
    const pairs = lanes.filter((l) => l.heat.workoutId).map((l) => ({ workoutId: l.heat.workoutId!, userId: l.registration.userId }));
    const subs = pairs.length ? await this.prisma.competitionSubmission.findMany({ where: { OR: pairs } }) : [];
    const sub = new Map(subs.map((s) => [`${s.workoutId}:${s.userId}`, s]));
    const rows = lanes.map((l) => {
      const w = l.heat.workout;
      const variant = w?.variants.find((v) => v.categoryId === l.registration.category.id);
      const s = w ? sub.get(`${w.id}:${l.registration.userId}`) : undefined;
      return {
        heat: { id: l.heat.id, number: l.heat.number, name: l.heat.name, startsAt: l.heat.startsAt, durationMin: l.heat.durationMin, startedAt: l.heat.startedAt },
        lane: l.lane,
        athlete: { id: l.registration.userId, ...(names.get(l.registration.userId) ?? { fullName: null, username: null }) },
        category: l.registration.category,
        workout: w
          ? {
              id: w.id,
              number: w.number,
              name: w.name,
              description: variant?.description ?? w.description,
              standards: variant?.standards ?? w.standards,
              timeCapS: variant?.timeCapS ?? w.timeCapS,
              scoreType: w.scoreType,
              scoringMethod: w.scoringMethod,
              maximumPoints: w.maximumPoints,
              movements: scoredMovements(w.movements),
            }
          : null,
        score: s ? { submissionId: s.id, status: s.status, raw: s.raw, rawValue: n(s.rawValue), points: n(s.points), at: s.updatedAt } : null,
      };
    });
    rows.sort((a, b) => (a.heat.startsAt?.getTime() ?? Infinity) - (b.heat.startsAt?.getTime() ?? Infinity) || a.heat.number - b.heat.number);
    return { serverTime: this.clock.now(), competition: { id: competition.id, title: competition.title, locked: competition.leaderboardLockedAt != null }, staffId: staff.id, lanes: rows };
  }

  /**
   * The lane's score, FINAL at once (ruling 1). The lane's judge or an organizer; the athlete must have confirmed.
   * A correction is the same call again: a new version, the leaderboard recomputed. Idempotent on clientId.
   */
  async score(user: AuthUser, competitionId: string, heatId: string, laneNo: number, dto: FloorScoreDto) {
    if (dto.athleteConfirmed !== true) throw AppException.validation([{ field: 'athleteConfirmed', code: 'REQUIRED' }]);
    return this.prisma.$transaction(async (tx) => {
      const lane = await tx.competitionHeatLane.findFirst({
        where: { heatId, lane: laneNo, heat: { competitionId } },
        include: { heat: { include: { workout: { include: { variants: true, competition: true } } } }, registration: true, judge: true },
      });
      if (!lane) throw AppException.notFound('Lane');
      const athleteId = lane.registration.userId;
      const w = lane.heat.workout;
      if (!w) throw new AppException(HttpStatus.CONFLICT, ErrorCode.PRECONDITION_FAILED, 'This heat has no WOD', { extra: { reason: 'HEAT_WITHOUT_WOD' } });

      const replay = await tx.competitionSubmission.findUnique({ where: { clientId: dto.clientId } });
      if (replay) {
        if (replay.workoutId !== w.id || replay.userId !== athleteId) throw AppException.conflict(ErrorCode.IDEMPOTENCY_CONFLICT);
        return this.scoreView(replay);
      }

      const organizer = await this.isOrganizer(user, competitionId, tx);
      const laneJudge = lane.judge?.userId === user.id && lane.judge.acceptedAt != null;
      if (!organizer && !laneJudge) throw AppException.forbidden('Only this lane’s judge or an organizer');
      if (athleteId === user.id && !this.judging.isPlatformAdmin(user)) throw AppException.forbidden('Judges cannot score themselves');
      if (w.competition.leaderboardLockedAt && !this.judging.isPlatformAdmin(user)) throw AppException.forbidden('The final leaderboard is locked');

      const raw: Record<string, unknown> = {};
      for (const k of RAW_KEYS) if (dto.raw[k] !== undefined && dto.raw[k] !== null) raw[k] = dto.raw[k];
      // Ruling 3: a capped athlete ranks after every finisher, by reps done (same maxReps for everyone on the floor).
      if (raw.capped === true) raw.maxReps = MAX_REPS;
      const capS = w.variants.find((v) => v.categoryId === lane.registration.categoryId)?.timeCapS ?? w.timeCapS;
      const value = rawValue(w.scoreType as ScoreType, { ...(raw as object), capS, movements: scoredMovements(w.movements) } as Parameters<typeof rawValue>[1]);
      if (value == null || !Number.isFinite(value) || value < 0) throw AppException.validation([{ field: 'raw', code: 'SCORE_REQUIRED' }]);
      if (w.scoreType === 'TIME' && !raw.capped && capS != null && value > capS) throw AppException.validation([{ field: 'raw.timeS', code: 'OVER_TIME_CAP' }]);
      if (w.scoringMethod === 'DIRECT_POINTS' && w.scoreType !== 'MOVEMENT_REPS' && value > w.maximumPoints) throw AppException.validation([{ field: 'raw.value', code: 'OVER_MAXIMUM_POINTS' }]);
      raw.floor = { heatId, lane: laneNo, judgeId: user.id, athleteConfirmed: true };

      const now = this.clock.now();
      const existing = await tx.competitionSubmission.findUnique({ where: { workoutId_userId: { workoutId: w.id, userId: athleteId } }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
      const data = { status: 'FINAL' as const, raw: raw as Prisma.InputJsonObject, rawValue: value, notes: dto.notes ?? existing?.notes ?? null, clientId: dto.clientId, submittedAt: now };
      const s = existing
        ? await tx.competitionSubmission.update({ where: { id: existing.id }, data })
        : await tx.competitionSubmission.create({ data: { id: uuidv7(), workoutId: w.id, registrationId: lane.registrationId, userId: athleteId, ...data } });
      await this.judging.recompute(tx, competitionId, lane.registration.categoryId);
      const after = await tx.competitionSubmission.findUniqueOrThrow({ where: { id: s.id } });
      const reason = `${existing ? 'Floor judge correction' : 'Floor judge'} · ${lane.heat.name} · lane ${laneNo}`;
      await tx.competitionScoreVersion.create({
        data: { id: uuidv7(), submissionId: s.id, version: (existing?.versions[0]?.version ?? 0) + 1, points: n(after.points) ?? 0, rawValue: value, reason, judgeId: user.id },
      });
      await this.audit.log(
        {
          actorId: user.id,
          actorRole: user.role,
          action: 'competition.submission.floor_scored',
          entityType: 'CompetitionSubmission',
          entityId: s.id,
          before: existing ? { status: existing.status, rawValue: n(existing.rawValue), points: n(existing.points) } : undefined,
          after: { status: after.status, rawValue: value, points: n(after.points), heatId, lane: laneNo },
        },
        tx,
      );
      await this.notifications.notify(tx, athleteId, 'COMPETITION_SCORE_APPROVED', { competitionId, submissionId: s.id, workoutName: w.name, reason });
      return this.scoreView(after);
    });
  }

  // ───────────── helpers ─────────────

  private scoreView(s: { id: string; status: string; raw: Prisma.JsonValue; rawValue: Prisma.Decimal | null; points: Prisma.Decimal | null; updatedAt: Date }) {
    return { submissionId: s.id, status: s.status, raw: s.raw, rawValue: n(s.rawValue), points: n(s.points), at: s.updatedAt };
  }

  private async isOrganizer(user: AuthUser, competitionId: string, tx: Prisma.TransactionClient = this.prisma) {
    return this.judging.isPlatformAdmin(user) || (await this.judging.roles(competitionId, user.id, tx)).has('ORGANIZER');
  }

  private async lane(competitionId: string, heatId: string, lane: number) {
    const row = await this.prisma.competitionHeatLane.findFirst({ where: { heatId, lane, heat: { competitionId } }, include: { registration: { select: { userId: true } } } });
    if (!row) throw AppException.notFound('Lane');
    return row;
  }
}
