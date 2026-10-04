import { HttpStatus, Injectable } from '@nestjs/common';
import { CompetitionStaffRole, CompetitionSubmission, CompetitionWorkout, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AdjustScoreDto, AppealDecisionDto, JudgeAthletesQueryDto, JudgeQueueQueryDto, PenaltyDto, ReasonDto } from './competitions.dto';
import { applyPenalty, clampPoints, leaderboard, placementPoints, placements, podium, type AthleteScores, type ScoreType, type TieBreakRule } from './domain';

type Tx = Prisma.TransactionClient;
const PLATFORM_ADMINS = new Set(['ADMIN', 'SUPER_ADMIN']);
const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v));

/**
 * Judging and official scores. Every score change is one transaction: new ScoreVersion (append-only), the
 * submission's status and points, the AuditLog row, the athlete's notification and the category leaderboard
 * recomputed from FINAL scores only (TOTAL = sum of the WOD points).
 */
@Injectable()
export class JudgingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────── Access ─────────────

  isPlatformAdmin(user: AuthUser): boolean {
    return PLATFORM_ADMINS.has(user.role);
  }

  async roles(competitionId: string, userId: string, tx: Tx = this.prisma): Promise<Set<CompetitionStaffRole>> {
    const rows = await tx.competitionStaff.findMany({ where: { competitionId, userId }, select: { role: true } });
    return new Set(rows.map((r) => r.role));
  }

  /** Throws unless the user is a platform admin or holds one of `allowed` on this competition. */
  async requireRole(user: AuthUser, competitionId: string, allowed: CompetitionStaffRole[], tx: Tx = this.prisma): Promise<Set<CompetitionStaffRole>> {
    if (this.isPlatformAdmin(user)) return new Set(['ORGANIZER', 'HEAD_JUDGE', 'JUDGE']);
    const mine = await this.roles(competitionId, user.id, tx);
    if (!allowed.some((r) => mine.has(r))) throw AppException.forbidden('Competition staff only');
    return mine;
  }

  // ───────────── Leaderboard ─────────────

  /** WOD points of each FINAL submission of a category, after placement and penalties. Writes them back. */
  private async officialPoints(tx: Tx, workouts: CompetitionWorkout[], userIds: string[]) {
    const subs = await tx.competitionSubmission.findMany({
      where: { workoutId: { in: workouts.map((w) => w.id) }, userId: { in: userIds } },
      include: { penalties: true },
    });
    const byWorkout = new Map<string, typeof subs>();
    for (const s of subs) byWorkout.set(s.workoutId, [...(byWorkout.get(s.workoutId) ?? []), s]);

    const scores = new Map<string, AthleteScores>(userIds.map((id) => [id, { athleteId: id, points: {}, places: {} }]));
    const pending = new Map<string, number>();
    for (const w of workouts) {
      const all = byWorkout.get(w.id) ?? [];
      const final = all.filter((s) => s.status === 'FINAL' && s.rawValue != null);
      for (const s of all) if (s.status !== 'FINAL' && s.status !== 'REJECTED') pending.set(s.userId, (pending.get(s.userId) ?? 0) + 1);
      const places = placements(
        final.map((s) => ({ id: s.id, value: Number(s.rawValue) })),
        w.scoreType as ScoreType,
      );
      for (const s of final) {
        const place = places.get(s.id)!;
        const base =
          w.scoringMethod === 'PLACEMENT_POINTS'
            ? placementPoints(place, (w.placementTable as number[]) ?? [], w.minimumPoints)
            : clampPoints(Number(s.rawValue), w.maximumPoints, w.minimumPoints);
        const penalty = s.penalties.reduce((sum, p) => sum + Number(p.points), 0);
        const points = applyPenalty(base, penalty, w.minimumPoints);
        if (n(s.points) !== points) await tx.competitionSubmission.update({ where: { id: s.id }, data: { points } });
        const a = scores.get(s.userId)!;
        a.points[w.id] = points;
        a.places![w.id] = place;
      }
    }
    return { scores: [...scores.values()], pending };
  }

  /** Rebuilds the materialized leaderboard of one category from FINAL scores (called inside every score transaction). */
  async recompute(tx: Tx, competitionId: string, categoryId: string): Promise<void> {
    const competition = await tx.competition.findUniqueOrThrow({ where: { id: competitionId } });
    const workouts = await tx.competitionWorkout.findMany({ where: { competitionId, active: true }, orderBy: { number: 'asc' } });
    const registrations = await tx.competitionRegistration.findMany({ where: { competitionId, categoryId, registrationStatus: 'CONFIRMED' }, select: { userId: true } });
    const userIds = registrations.map((r) => r.userId);
    const { scores, pending } = await this.officialPoints(tx, workouts, userIds);
    const rows = leaderboard(scores, (competition.tieBreakRules as unknown as TieBreakRule[]) ?? [], workouts.map((w) => w.id));
    await tx.competitionLeaderboardEntry.deleteMany({ where: { competitionId, categoryId } });
    if (rows.length) {
      await tx.competitionLeaderboardEntry.createMany({
        data: rows.map((r) => ({
          id: uuidv7(),
          competitionId,
          categoryId,
          userId: r.athleteId,
          wodPoints: r.points,
          totalPoints: r.total,
          rank: r.rank,
          pendingCount: pending.get(r.athleteId) ?? 0,
        })),
      });
    }
  }

  /** Category leaderboard (or one WOD's ranking), with podium and prizes once final. */
  async leaderboard(competitionId: string, categoryId: string, workoutId?: string) {
    const competition = await this.prisma.competition.findFirst({ where: { id: competitionId, deletedAt: null } });
    if (!competition) throw AppException.notFound('Competition');
    const workouts = await this.prisma.competitionWorkout.findMany({ where: { competitionId, active: true }, orderBy: { number: 'asc' }, select: { id: true, number: true, name: true, maximumPoints: true } });
    const entries = await this.prisma.competitionLeaderboardEntry.findMany({ where: { competitionId, categoryId }, orderBy: [{ rank: 'asc' }, { totalPoints: 'desc' }] });
    const profiles = await this.prisma.profile.findMany({ where: { userId: { in: entries.map((e) => e.userId) } }, select: { userId: true, fullName: true, user: { select: { username: true } } } });
    const names = new Map(profiles.map((p) => [p.userId, { fullName: p.fullName, username: p.user.username }]));
    const final = competition.status === 'FINAL_LEADERBOARD' || competition.status === 'FINISHED';
    let rows = entries.map((e) => ({
      rank: e.rank,
      athlete: { id: e.userId, ...names.get(e.userId) },
      wodPoints: e.wodPoints as Record<string, number>,
      totalPoints: Number(e.totalPoints),
      pending: e.pendingCount,
    }));
    if (workoutId) {
      rows = [...rows]
        .filter((r) => r.wodPoints[workoutId] != null)
        .sort((a, b) => b.wodPoints[workoutId] - a.wodPoints[workoutId])
        .map((r, i, all) => ({ ...r, rank: i > 0 && all[i - 1].wodPoints[workoutId] === r.wodPoints[workoutId] ? 0 : i + 1 }))
        .map((r, i, all) => ({ ...r, rank: r.rank || all.slice(0, i).reverse().find((x) => x.rank)!.rank }));
    }
    const prizes = final ? await this.prisma.competitionPrize.findMany({ where: { competitionId, OR: [{ categoryId }, { categoryId: null }] }, orderBy: { position: 'asc' } }) : [];
    const p = podium(rows.map((r) => ({ athleteId: r.athlete.id, total: r.totalPoints, rank: r.rank, points: r.wodPoints })));
    return {
      status: competition.status,
      provisional: !final,
      maximumPoints: workouts.reduce((s, w) => s + w.maximumPoints, 0),
      workouts,
      rows,
      podium: final ? { gold: p.gold.map((r) => r.athleteId), silver: p.silver.map((r) => r.athleteId), bronze: p.bronze.map((r) => r.athleteId) } : null,
      prizes,
    };
  }

  // ───────────── Judge queue ─────────────

  async queue(user: AuthUser, q: JudgeQueueQueryDto) {
    const statusFilter: Record<string, Prisma.CompetitionSubmissionWhereInput['status']> = {
      PENDING: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
      APPROVED: 'FINAL',
      REJECTED: 'REJECTED',
      PENALIZED: 'FINAL',
      ALL: { not: 'DRAFT' },
    };
    const where: Prisma.CompetitionSubmissionWhereInput = { status: statusFilter[q.status ?? 'PENDING'], ...(q.workoutId ? { workoutId: q.workoutId } : {}) };
    if (q.status === 'PENALIZED') where.penalties = { some: {} };
    if (q.competitionId) where.workout = { competitionId: q.competitionId };
    if (!this.isPlatformAdmin(user)) {
      const staff = await this.prisma.competitionStaff.findMany({ where: { userId: user.id, role: { in: ['JUDGE', 'HEAD_JUDGE', 'ORGANIZER'] } }, include: { assignments: true } });
      if (!staff.length) throw AppException.forbidden('Judges only');
      // Head judges and organizers see their whole competition; judges with assignments see only those.
      where.OR = staff.flatMap((s) =>
        s.role !== 'JUDGE' || s.assignments.length === 0
          ? [{ workout: { competitionId: s.competitionId } }]
          : s.assignments.map((a) => ({ workout: { competitionId: s.competitionId }, ...(a.workoutId ? { workoutId: a.workoutId } : {}) })),
      );
    }
    const subs = await this.prisma.competitionSubmission.findMany({
      where,
      orderBy: { submittedAt: 'asc' },
      take: 200,
      include: { workout: { select: { id: true, name: true, number: true, competitionId: true, scoreType: true, competition: { select: { title: true } } } } },
    });
    const regs = await this.prisma.competitionRegistration.findMany({ where: { id: { in: subs.map((s) => s.registrationId) } }, include: { category: { select: { id: true, name: true } } } });
    const cat = new Map(regs.map((r) => [r.id, r.category]));
    const rows = subs.filter((s) => !q.categoryId || cat.get(s.registrationId)?.id === q.categoryId);
    const names = await this.names(rows.map((s) => s.userId));
    return rows.map((s) => this.view(s, names.get(s.userId), cat.get(s.registrationId)));
  }

  /**
   * Judge view by athlete: for each competition the user judges, every confirmed athlete with the WODs they
   * submitted (drafts excluded) and each YouTube link. Same visibility as the queue: head judges, organizers
   * and judges without WOD assignments see every WOD; assigned judges see their WODs only.
   */
  async athletes(user: AuthUser, q: JudgeAthletesQueryDto) {
    const scopes = new Map<string, Set<string> | null>(); // competition → WOD ids (null = every WOD)
    if (this.isPlatformAdmin(user)) {
      const ids = q.competitionId
        ? [q.competitionId]
        : (await this.prisma.competitionWorkout.findMany({ where: { submissions: { some: { status: { not: 'DRAFT' } } } }, select: { competitionId: true }, distinct: ['competitionId'] })).map((w) => w.competitionId);
      for (const id of ids) scopes.set(id, null);
    } else {
      const staff = await this.prisma.competitionStaff.findMany({
        where: { userId: user.id, role: { in: ['JUDGE', 'HEAD_JUDGE', 'ORGANIZER'] }, ...(q.competitionId ? { competitionId: q.competitionId } : {}) },
        include: { assignments: true },
      });
      if (!staff.length) throw AppException.forbidden('Judges only');
      for (const s of staff) {
        const all = s.role !== 'JUDGE' || s.assignments.length === 0 || s.assignments.some((a) => !a.workoutId);
        const current = scopes.get(s.competitionId);
        if (all || current === null) scopes.set(s.competitionId, null);
        else scopes.set(s.competitionId, new Set([...(current ?? []), ...s.assignments.map((a) => a.workoutId!)]));
      }
    }
    const competitions = await this.prisma.competition.findMany({
      where: { id: { in: [...scopes.keys()] }, deletedAt: null },
      select: { id: true, title: true, workouts: { where: { active: true }, select: { id: true } } },
      orderBy: { eventStart: 'desc' },
    });
    const regs = await this.prisma.competitionRegistration.findMany({
      where: { competitionId: { in: competitions.map((c) => c.id) }, registrationStatus: 'CONFIRMED', ...(q.categoryId ? { categoryId: q.categoryId } : {}) },
      include: { category: { select: { id: true, name: true } } },
    });
    const subs = await this.prisma.competitionSubmission.findMany({
      where: { registrationId: { in: regs.map((r) => r.id) }, status: { not: 'DRAFT' } },
      include: { workout: { select: { id: true, name: true, number: true, competitionId: true, scoreType: true } } },
      orderBy: { workout: { number: 'asc' } },
    });
    const byRegistration = new Map<string, typeof subs>();
    for (const s of subs) {
      const allowed = scopes.get(s.workout.competitionId);
      if (allowed && !allowed.has(s.workoutId)) continue;
      byRegistration.set(s.registrationId, [...(byRegistration.get(s.registrationId) ?? []), s]);
    }
    const names = await this.names(regs.map((r) => r.userId));
    return competitions.map((c) => ({
      competition: { id: c.id, title: c.title },
      wodCount: c.workouts.filter((w) => scopes.get(c.id)?.has(w.id) ?? true).length,
      athletes: regs
        .filter((r) => r.competitionId === c.id)
        .map((r) => ({
          athlete: { id: r.userId, ...names.get(r.userId) },
          category: r.category,
          submissions: (byRegistration.get(r.id) ?? []).map((s) => ({
            id: s.id,
            status: s.status,
            workout: { id: s.workout.id, name: s.workout.name, number: s.workout.number, scoreType: s.workout.scoreType },
            rawValue: n(s.rawValue),
            points: n(s.points),
            videoUrl: s.videoUrl,
            youtubeId: s.youtubeId,
            submittedAt: s.submittedAt,
          })),
        }))
        .sort((a, b) => a.category.name.localeCompare(b.category.name) || (a.athlete.fullName ?? a.athlete.username ?? '').localeCompare(b.athlete.fullName ?? b.athlete.username ?? '')),
    }));
  }

  async detail(user: AuthUser, submissionId: string) {
    const s = await this.prisma.competitionSubmission.findUnique({
      where: { id: submissionId },
      include: { workout: true, versions: { orderBy: { version: 'asc' } }, penalties: true, appeals: true },
    });
    if (!s) throw AppException.notFound('Submission');
    const mine = s.userId === user.id;
    const roles = mine ? null : await this.requireRole(user, s.workout.competitionId, ['JUDGE', 'HEAD_JUDGE', 'ORGANIZER']);
    const reg = await this.prisma.competitionRegistration.findUnique({ where: { id: s.registrationId }, include: { category: { select: { id: true, name: true } } } });
    const names = await this.names([s.userId]);
    // Version history is for head judges, organizers and admins (§30); the athlete sees the official result.
    const history = roles && (roles.has('HEAD_JUDGE') || roles.has('ORGANIZER'));
    return {
      ...this.view(s, names.get(s.userId), reg?.category),
      workout: s.workout,
      raw: s.raw,
      notes: s.notes,
      penalties: s.penalties.map((p) => ({ ...p, points: Number(p.points) })),
      versions: history ? s.versions.map((v) => ({ ...v, points: Number(v.points), rawValue: n(v.rawValue) })) : undefined,
      appeals: s.appeals,
    };
  }

  // ───────────── Judge actions ─────────────

  approve(user: AuthUser, id: string, dto?: Partial<ReasonDto>) {
    return this.decide(user, id, 'approve', (s) => ({ status: 'FINAL', reason: dto?.reason ?? 'Approved', notification: 'COMPETITION_SCORE_APPROVED' as const, rawValue: n(s.rawValue) }));
  }

  reject(user: AuthUser, id: string, dto: ReasonDto) {
    return this.decide(user, id, 'reject', (s) => ({ status: 'REJECTED', reason: dto.reason, notification: 'COMPETITION_SCORE_REJECTED' as const, rawValue: n(s.rawValue) }));
  }

  needsCorrection(user: AuthUser, id: string, dto: ReasonDto) {
    return this.decide(user, id, 'needs-correction', (s) => ({ status: 'NEEDS_CORRECTION', reason: dto.reason, notification: 'COMPETITION_SCORE_NEEDS_CORRECTION' as const, rawValue: n(s.rawValue) }));
  }

  penalize(user: AuthUser, id: string, dto: PenaltyDto) {
    return this.decide(user, id, 'penalty', (s) => ({ status: 'FINAL', reason: `${dto.type}: ${dto.reason}`, notification: 'COMPETITION_SCORE_MODIFIED' as const, rawValue: n(s.rawValue), penalty: dto }));
  }

  adjust(user: AuthUser, id: string, dto: AdjustScoreDto) {
    return this.decide(user, id, 'adjust-score', (s, w) => {
      const value = w.scoringMethod === 'DIRECT_POINTS' ? (dto.points ?? dto.rawValue) : (dto.rawValue ?? null);
      if (value == null) throw AppException.validation([{ field: w.scoringMethod === 'DIRECT_POINTS' ? 'points' : 'rawValue', code: 'REQUIRED' }]);
      return { status: 'FINAL', reason: dto.reason, notification: 'COMPETITION_SCORE_MODIFIED' as const, rawValue: value };
    });
  }

  private async decide(
    user: AuthUser,
    id: string,
    action: string,
    plan: (s: CompetitionSubmission, w: CompetitionWorkout) => {
      status: 'FINAL' | 'REJECTED' | 'NEEDS_CORRECTION';
      reason: string;
      notification: 'COMPETITION_SCORE_APPROVED' | 'COMPETITION_SCORE_REJECTED' | 'COMPETITION_SCORE_NEEDS_CORRECTION' | 'COMPETITION_SCORE_MODIFIED';
      rawValue: number | null;
      penalty?: PenaltyDto;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.competitionSubmission.findUnique({ where: { id }, include: { workout: { include: { competition: true } }, versions: { orderBy: { version: 'desc' }, take: 1 } } });
      if (!s) throw AppException.notFound('Submission');
      const competition = s.workout.competition;
      const roles = await this.requireRole(user, competition.id, ['JUDGE', 'HEAD_JUDGE'], tx);
      if (s.userId === user.id && !this.isPlatformAdmin(user)) throw AppException.forbidden('Judges cannot review their own score');
      if (s.status === 'DRAFT') throw AppException.conflict(ErrorCode.CONFLICT, 'Draft submissions are not reviewed');
      // A locked (final) leaderboard only changes through a head judge or an admin, and always leaves an audit row.
      if (competition.leaderboardLockedAt && !(this.isPlatformAdmin(user) || roles.has('HEAD_JUDGE'))) {
        throw AppException.forbidden('The final leaderboard is locked');
      }
      const p = plan(s, s.workout);
      const before = { status: s.status, rawValue: n(s.rawValue), points: n(s.points) };
      if (p.penalty) {
        await tx.competitionPenalty.create({ data: { id: uuidv7(), submissionId: s.id, type: p.penalty.type, points: p.penalty.points, reason: p.penalty.reason, judgeId: user.id } });
      }
      await tx.competitionSubmission.update({ where: { id: s.id }, data: { status: p.status, rawValue: p.rawValue } });
      const reg = await tx.competitionRegistration.findUniqueOrThrow({ where: { id: s.registrationId } });
      await this.recompute(tx, competition.id, reg.categoryId);
      const after = await tx.competitionSubmission.findUniqueOrThrow({ where: { id: s.id } });
      await tx.competitionScoreVersion.create({
        data: { id: uuidv7(), submissionId: s.id, version: (s.versions[0]?.version ?? 0) + 1, points: n(after.points) ?? 0, rawValue: p.rawValue, reason: p.reason, judgeId: user.id },
      });
      await this.audit.log(
        {
          actorId: user.id,
          actorRole: user.role,
          action: `competition.submission.${action}`,
          entityType: 'CompetitionSubmission',
          entityId: s.id,
          before,
          after: { status: after.status, rawValue: n(after.rawValue), points: n(after.points), reason: p.reason, ...(p.penalty ? { penalty: { ...p.penalty } } : {}) },
        },
        tx,
      );
      await this.notifications.notify(tx, s.userId, p.notification, { competitionId: competition.id, submissionId: s.id, workoutName: s.workout.name, reason: p.reason });
      return { id: s.id, status: after.status, rawValue: n(after.rawValue), points: n(after.points) };
    });
  }

  // ───────────── Appeals ─────────────

  async appeal(user: AuthUser, submissionId: string, dto: ReasonDto) {
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.competitionSubmission.findUnique({ where: { id: submissionId }, include: { workout: { include: { competition: true } } } });
      if (!s || s.userId !== user.id) throw AppException.notFound('Submission');
      const deadline = s.workout.competition.appealDeadline;
      if (s.workout.competition.leaderboardLockedAt || (deadline && this.clock.now() > deadline)) {
        throw new AppException(HttpStatus.CONFLICT, ErrorCode.PRECONDITION_FAILED, 'Appeals are closed');
      }
      if (await tx.competitionAppeal.findFirst({ where: { submissionId, status: 'PENDING' } })) throw AppException.conflict(ErrorCode.CONFLICT, 'An appeal is already pending');
      const appeal = await tx.competitionAppeal.create({ data: { id: uuidv7(), submissionId, userId: user.id, reason: dto.reason } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.appeal.created', entityType: 'CompetitionAppeal', entityId: appeal.id, after: { submissionId, reason: dto.reason } }, tx);
      return appeal;
    });
  }

  async appeals(user: AuthUser, competitionId: string) {
    await this.requireRole(user, competitionId, ['HEAD_JUDGE', 'ORGANIZER']);
    return this.prisma.competitionAppeal.findMany({ where: { submission: { workout: { competitionId } } }, orderBy: { createdAt: 'asc' }, include: { submission: { select: { id: true, workoutId: true, userId: true, status: true, points: true } } } });
  }

  /** The head judge has the final word; an accepted appeal may correct the score (new version + recompute). */
  async decideAppeal(user: AuthUser, appealId: string, dto: AppealDecisionDto) {
    const appeal = await this.prisma.competitionAppeal.findUnique({ where: { id: appealId }, include: { submission: { include: { workout: true } } } });
    if (!appeal) throw AppException.notFound('Appeal');
    const roles = await this.requireRole(user, appeal.submission.workout.competitionId, ['HEAD_JUDGE']);
    if (!roles.has('HEAD_JUDGE') && !this.isPlatformAdmin(user)) throw AppException.forbidden('Head judge only');
    if (appeal.status !== 'PENDING') throw AppException.conflict(ErrorCode.CONFLICT, 'Appeal already decided');
    if (dto.status === 'ACCEPTED' && (dto.rawValue != null || dto.points != null)) {
      await this.adjust(user, appeal.submissionId, { rawValue: dto.rawValue, points: dto.points, reason: `Appeal: ${dto.response}` });
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.competitionAppeal.update({ where: { id: appealId }, data: { status: dto.status, response: dto.response, reviewedById: user.id, reviewedAt: this.clock.now() } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.appeal.decided', entityType: 'CompetitionAppeal', entityId: appealId, after: { status: dto.status, response: dto.response } }, tx);
      await this.notifications.notify(tx, appeal.userId, 'COMPETITION_APPEAL_DECIDED', { competitionId: appeal.submission.workout.competitionId, submissionId: appeal.submissionId, status: dto.status });
      return updated;
    });
  }

  // ───────────── Publication ─────────────

  /** Head judge validates: every category recomputed, leaderboard locked, athletes notified. */
  async publish(user: AuthUser, competitionId: string) {
    const roles = await this.requireRole(user, competitionId, ['HEAD_JUDGE']);
    if (!roles.has('HEAD_JUDGE') && !this.isPlatformAdmin(user)) throw AppException.forbidden('Head judge only');
    return this.prisma.$transaction(async (tx) => {
      const competition = await tx.competition.findUniqueOrThrow({ where: { id: competitionId } });
      if (await tx.competitionAppeal.count({ where: { status: 'PENDING', submission: { workout: { competitionId } } } })) {
        throw new AppException(HttpStatus.CONFLICT, ErrorCode.PRECONDITION_FAILED, 'Resolve pending appeals first');
      }
      const categories = await tx.competitionCategory.findMany({ where: { competitionId }, select: { id: true } });
      for (const c of categories) await this.recompute(tx, competitionId, c.id);
      const now = this.clock.now();
      await tx.competition.update({ where: { id: competitionId }, data: { status: 'FINAL_LEADERBOARD', leaderboardLockedAt: now } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.leaderboard.published', entityType: 'Competition', entityId: competitionId, before: { status: competition.status }, after: { status: 'FINAL_LEADERBOARD', lockedAt: now.toISOString() } }, tx);
      const athletes = await tx.competitionRegistration.findMany({ where: { competitionId, registrationStatus: 'CONFIRMED' }, select: { userId: true } });
      for (const a of athletes) await this.notifications.notify(tx, a.userId, 'COMPETITION_LEADERBOARD_FINAL', { competitionId, title: competition.title });
      return { status: 'FINAL_LEADERBOARD', lockedAt: now };
    });
  }

  // ───────────── helpers ─────────────

  async names(userIds: string[]) {
    const profiles = await this.prisma.profile.findMany({ where: { userId: { in: userIds } }, select: { userId: true, fullName: true, user: { select: { username: true } } } });
    return new Map(profiles.map((p) => [p.userId, { fullName: p.fullName, username: p.user.username }]));
  }

  private view(s: CompetitionSubmission & { workout?: { id: string; name: string; number: number; competitionId: string } }, athlete?: { fullName: string; username: string }, category?: { id: string; name: string } | null) {
    return {
      id: s.id,
      status: s.status,
      athlete: { id: s.userId, ...athlete },
      category: category ?? null,
      workout: s.workout ? { id: s.workout.id, name: s.workout.name, number: s.workout.number, competitionId: s.workout.competitionId } : undefined,
      rawValue: n(s.rawValue),
      points: n(s.points),
      videoUrl: s.videoUrl,
      youtubeId: s.youtubeId,
      submittedAt: s.submittedAt,
    };
  }
}
