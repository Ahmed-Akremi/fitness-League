import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser, JUDGE_ROLES } from '../../common/auth/auth-user';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { CursorCodec } from '../../common/pagination/cursor';
import { toPage } from '../../common/pagination/page';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { divisionFor, LedgerService } from '../ledger/ledger.service';
import { ruleSetConfigSchema } from '../scoring/rule-set.schema';
import { RuleSetService } from '../scoring/rule-set.service';
import { SeasonsService } from '../seasons/seasons.service';
import { WeeklyScoreService } from '../seasons/weekly-score.service';
import {
  AuditQueryDto,
  CreateDraftDto,
  CreateJudgeDto,
  CreateSeasonDto,
  ExerciseDto,
  LedgerAdjustmentDto,
  RecomputeDto,
  ListUsersQueryDto,
  ReplaceExpectedProgressionDto,
  SportDto,
  UpdateDraftDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
} from './dto/admin.dto';

const RANK: Record<Role, number> = { USER: 0, JUDGE: 1, HEAD_JUDGE: 1, GYM_ADMIN: 1, MODERATOR: 2, ADMIN: 3, SUPER_ADMIN: 4 };
const DRY_RUN_SAMPLE = 200;

/** Admin panel back-end (docs §4.4 admin, RBAC matrix §9.2). Every change is audited with before/after. */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleSets: RuleSetService,
    private readonly weekly: WeeklyScoreService,
    private readonly seasons: SeasonsService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly cursors: CursorCodec,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
  ) {}

  // ───────────── Dashboard ─────────────

  async overview() {
    const now = this.clock.now();
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const [users, active7d, workouts7d, held, pendingGyms, season, ruleSet] = await Promise.all([
      this.prisma.user.count({ where: { status: { not: 'DELETED' } } }),
      this.prisma.user.count({ where: { lastLoginAt: { gte: weekAgo } } }),
      this.prisma.workout.count({ where: { receivedAt: { gte: weekAgo }, deletedAt: null } }),
      this.prisma.workout.count({ where: { status: 'HELD_FOR_REVIEW', deletedAt: null } }),
      this.prisma.gymVerificationRequest.count({ where: { status: 'PENDING' } }),
      this.seasons.current(),
      this.ruleSets.getActive(),
    ]);
    return {
      users,
      active7d,
      workouts7d,
      heldWorkouts: held,
      pendingGyms,
      activeSeason: season && { id: season.id, name: season.name, endsAt: season.endsAt.toISOString() },
      activeRuleSetVersion: ruleSet.version,
    };
  }

  // ───────────── Users ─────────────

  async users(q: ListUsersQueryDto) {
    const c = q.cursor ? this.cursors.decode<{ id: string }>(q.cursor) : null;
    const where: Prisma.UserWhereInput = {
      role: q.role,
      status: q.status,
      ...(q.q && { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { username: { contains: q.q, mode: 'insensitive' } }, { profile: { fullName: { contains: q.q, mode: 'insensitive' } } }] }),
      ...(c && { id: { lt: c.id } }),
    };
    const rows = await this.prisma.user.findMany({ where, orderBy: { id: 'desc' }, take: q.limit + 1, include: { profile: { select: { fullName: true } }, stats: true } });
    const page = toPage(rows, q.limit, (r) => ({ id: r.id }), (k) => this.cursors.encode(k));
    return {
      data: page.data.map((u) => ({
        id: u.id,
        email: u.email,
        username: u.username,
        fullName: u.profile?.fullName,
        role: u.role,
        status: u.status,
        emailVerified: u.emailVerifiedAt !== null,
        level: u.stats?.level ?? 1,
        seasonLp: u.stats?.seasonLp ?? 0,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      })),
      page: page.page,
    };
  }

  async user(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, include: { profile: { include: { governorate: true, primaryGym: true } }, stats: { include: { division: true } } } });
    if (!u) throw AppException.notFound('User');
    const [workouts, held, rejected, audit] = await Promise.all([
      this.prisma.workout.count({ where: { userId: id, deletedAt: null } }),
      this.prisma.workout.count({ where: { userId: id, status: 'HELD_FOR_REVIEW', deletedAt: null } }),
      this.prisma.workout.count({ where: { userId: id, status: 'REJECTED' } }),
      this.prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    // Staff see account data, never health data (body weight is not in this payload).
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      fullName: u.profile?.fullName,
      role: u.role,
      status: u.status,
      suspendedUntil: u.suspendedUntil?.toISOString() ?? null,
      emailVerified: u.emailVerifiedAt !== null,
      governorate: u.profile?.governorate.code,
      gym: u.profile?.primaryGym?.name ?? null,
      level: u.stats?.level ?? 1,
      xpTotal: Number(u.stats?.xpTotal ?? 0),
      seasonLp: u.stats?.seasonLp ?? 0,
      division: u.stats?.division?.code ?? null,
      workouts: { total: workouts, held, rejected },
      audit: audit.map((a) => ({ action: a.action, actorId: a.actorId, at: a.createdAt.toISOString(), after: a.after })),
    };
  }

  async setStatus(actor: AuthUser, id: string, dto: UpdateUserStatusDto) {
    const target = await this.actOn(actor, id);
    if (dto.status === 'BANNED' && RANK[actor.role] < RANK.ADMIN) throw AppException.forbidden('Only admins can ban.');
    const until = dto.status === 'SUSPENDED' && dto.until ? new Date(dto.until) : null;
    if (until && until <= this.clock.now()) throw AppException.validation([{ field: 'until', code: 'MUST_BE_IN_FUTURE' }]);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        // Any sanction signs the user out everywhere immediately.
        data: { status: dto.status, suspendedUntil: until, ...(dto.status !== 'ACTIVE' && { sessionVersion: { increment: 1 } }) },
      });
      if (dto.status !== 'ACTIVE') await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: this.clock.now() } });
      await this.audit.log(
        { actorId: actor.id, actorRole: actor.role, action: `USER_${dto.status}`, entityType: 'user', entityId: id, before: { status: target.status }, after: { status: dto.status, until: until?.toISOString() ?? null, reason: dto.reason } },
        tx,
      );
    });
    return this.user(id);
  }

  /** ADMIN may grant up to MODERATOR; only SUPER_ADMIN grants ADMIN/SUPER_ADMIN; nobody changes their own role. */
  async setRole(actor: AuthUser, id: string, dto: UpdateUserRoleDto) {
    const target = await this.actOn(actor, id);
    const ceiling = actor.role === 'SUPER_ADMIN' ? RANK.SUPER_ADMIN : RANK.MODERATOR;
    if (RANK[dto.role] > ceiling) throw AppException.forbidden('You cannot grant this role.');
    if ((JUDGE_ROLES.includes(dto.role) || JUDGE_ROLES.includes(target.role)) && RANK[actor.role] < RANK.ADMIN) throw AppException.forbidden('Only admins manage judge accounts.');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { role: dto.role, sessionVersion: { increment: 1 } } });
      await this.audit.log({ actorId: actor.id, actorRole: actor.role, action: 'USER_ROLE_CHANGED', entityType: 'user', entityId: id, before: { role: target.role }, after: { role: dto.role } }, tx);
    });
    return this.user(id);
  }

  // ───────────── Judge accounts ─────────────

  async judges() {
    const rows = await this.prisma.user.findMany({ where: { role: { in: JUDGE_ROLES }, status: { not: 'DELETED' } }, orderBy: { username: 'asc' } });
    return rows.map((u) => ({ id: u.id, email: u.email, username: u.username, role: u.role, status: u.status, lastLoginAt: u.lastLoginAt?.toISOString() ?? null }));
  }

  /**
   * A judge-only account with a generated password, shown once to the admin who hands it over. No profile:
   * judges never use the app, so they never compete or score.
   */
  async createJudge(actor: AuthUser, dto: CreateJudgeDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findFirst({ where: { OR: [{ email }, { username: dto.username }] } })) {
      throw AppException.conflict(ErrorCode.CONFLICT, 'Email or username already used');
    }
    const password = randomBytes(9).toString('base64url');
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          id: uuidv7(),
          email,
          username: dto.username,
          role: dto.role,
          passwordHash: await this.passwords.hash(password),
          emailVerifiedAt: this.clock.now(),
          dateOfBirth: new Date('1970-01-01'), // required column, unused for judge accounts
        },
      });
      await this.audit.log({ actorId: actor.id, actorRole: actor.role, action: 'JUDGE_ACCOUNT_CREATED', entityType: 'user', entityId: u.id, after: { email, username: dto.username, role: dto.role } }, tx);
      return u;
    });
    return { id: user.id, email: user.email, username: user.username, role: user.role, password };
  }

  /** A new generated password for a judge account, shown once; the old password and every session stop working. */
  async resetJudgePassword(actor: AuthUser, id: string) {
    const judge = await this.prisma.user.findUnique({ where: { id } });
    if (!judge || judge.status === 'DELETED' || !JUDGE_ROLES.includes(judge.role)) throw AppException.notFound('Judge');
    const password = randomBytes(9).toString('base64url');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash: await this.passwords.hash(password), failedLoginCount: 0, lockedUntil: null, sessionVersion: { increment: 1 } } });
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: this.clock.now() } });
      await this.audit.log({ actorId: actor.id, actorRole: actor.role, action: 'JUDGE_PASSWORD_RESET', entityType: 'user', entityId: id }, tx);
    });
    return { id: judge.id, email: judge.email, username: judge.username, role: judge.role, password };
  }

  private async actOn(actor: AuthUser, id: string) {
    if (actor.id === id) throw AppException.forbidden('You cannot change your own account here.');
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target || target.status === 'DELETED') throw AppException.notFound('User');
    if (RANK[target.role] >= RANK[actor.role]) throw AppException.forbidden('Target has an equal or higher role.');
    return target;
  }

  // ───────────── Rule sets ─────────────

  async ruleSetList() {
    const rows = await this.prisma.scoringRuleSet.findMany({ orderBy: { version: 'desc' } });
    return rows.map((r) => ({ version: r.version, status: r.status, changeNote: r.changeNote, basedOnVersion: r.basedOnVersion, activatedAt: r.activatedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() }));
  }

  async ruleSet(version: number) {
    const r = await this.prisma.scoringRuleSet.findUnique({ where: { version } });
    if (!r) throw AppException.notFound('Rule set');
    return { version: r.version, status: r.status, changeNote: r.changeNote, basedOnVersion: r.basedOnVersion, config: r.config, activatedAt: r.activatedAt?.toISOString() ?? null };
  }

  async createDraft(actor: AuthUser, dto: CreateDraftDto) {
    const base = dto.basedOn
      ? await this.prisma.scoringRuleSet.findUnique({ where: { version: dto.basedOn }, include: { expectedProgression: true } })
      : await this.prisma.scoringRuleSet.findFirst({ where: { status: 'ACTIVE' }, include: { expectedProgression: true } });
    if (!base) throw AppException.notFound('Rule set');
    const last = await this.prisma.scoringRuleSet.aggregate({ _max: { version: true } });
    const version = (last._max.version ?? 0) + 1;
    const id = uuidv7();
    await this.prisma.$transaction(async (tx) => {
      await tx.scoringRuleSet.create({ data: { id, version, status: 'DRAFT', config: base.config as Prisma.InputJsonValue, configHash: base.configHash, basedOnVersion: base.version, changeNote: dto.changeNote, createdById: actor.id } });
      await tx.expectedProgression.createMany({ data: base.expectedProgression.map(({ id: _id, ruleSetId: _r, ...row }) => ({ ...row, id: uuidv7(), ruleSetId: id })) });
      await this.audit.log({ actorId: actor.id, actorRole: actor.role, action: 'RULESET_DRAFT_CREATED', entityType: 'scoring_rule_set', entityId: id, after: { version, basedOn: base.version } }, tx);
    });
    return this.ruleSet(version);
  }

  async updateDraft(actor: AuthUser, version: number, dto: UpdateDraftDto) {
    const draft = await this.draft(version);
    const parsed = ruleSetConfigSchema.safeParse(dto.config);
    if (!parsed.success) {
      throw AppException.validation(parsed.error.issues.map((i) => ({ field: `config.${i.path.join('.')}`, code: 'INVALID', params: { message: i.message } })));
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.scoringRuleSet.update({
        where: { id: draft.id },
        data: { config: parsed.data as Prisma.InputJsonValue, configHash: hash(parsed.data), changeNote: dto.changeNote ?? draft.changeNote },
      });
      await this.audit.log({ actorId: actor.id, actorRole: actor.role, action: 'RULESET_DRAFT_UPDATED', entityType: 'scoring_rule_set', entityId: draft.id, before: draft.config as Prisma.InputJsonValue, after: parsed.data as Prisma.InputJsonValue }, tx);
    });
    return this.ruleSet(version);
  }

  async expectedProgression(version: number) {
    const rows = await this.prisma.expectedProgression.findMany({ where: { ruleSet: { version } }, include: { exercise: true, metricType: true }, orderBy: [{ metricTypeId: 'asc' }, { experienceLevel: 'asc' }] });
    return rows.map((r) => ({ level: r.experienceLevel, exercise: r.exercise?.code ?? null, metric: r.metricType.code, pct: Number(r.expectedPct), periodDays: r.periodDays }));
  }

  async replaceExpectedProgression(actor: AuthUser, version: number, dto: ReplaceExpectedProgressionDto) {
    const draft = await this.draft(version);
    const config = ruleSetConfigSchema.parse(draft.config);
    const exercises = new Map((await this.prisma.exercise.findMany()).map((e) => [e.code, e.id]));
    const metrics = new Map((await this.prisma.metricType.findMany()).map((m) => [m.code, m.id]));
    const seen = new Set<string>();
    const data = dto.rows.map((r, i) => {
      const metricTypeId = metrics.get(r.metric);
      const exerciseId = r.exercise ? exercises.get(r.exercise) : null;
      if (!metricTypeId) throw AppException.validation([{ field: `rows[${i}].metric`, code: 'UNKNOWN_METRIC' }]);
      if (r.exercise && !exerciseId) throw AppException.validation([{ field: `rows[${i}].exercise`, code: 'UNKNOWN_EXERCISE' }]);
      const key = `${r.level}|${r.exercise ?? '*'}|${r.metric}`;
      if (seen.has(key)) throw AppException.validation([{ field: `rows[${i}]`, code: 'DUPLICATE' }]);
      seen.add(key);
      return { id: uuidv7(), ruleSetId: draft.id, experienceLevel: r.level, exerciseId, metricTypeId, periodDays: config.progress_window_days, expectedPct: r.pct };
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.expectedProgression.deleteMany({ where: { ruleSetId: draft.id } });
      await tx.expectedProgression.createMany({ data });
      await this.audit.log({ actorId: actor.id, actorRole: actor.role, action: 'RULESET_EXPECTED_PROGRESSION_REPLACED', entityType: 'scoring_rule_set', entityId: draft.id, after: { rows: data.length } }, tx);
    });
    return this.expectedProgression(version);
  }

  /** Schema check + dry run: last closed week re-scored under the draft vs the active rule set (docs §5.2). */
  async validate(version: number) {
    const draft = await this.prisma.scoringRuleSet.findUnique({ where: { version } });
    if (!draft) throw AppException.notFound('Rule set');
    const parsed = ruleSetConfigSchema.safeParse(draft.config);
    if (!parsed.success) return { valid: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
    const active = await this.ruleSets.getActive();
    const week = this.seasons.lastClosableWeek(this.clock.now(), active.config.week_grace_hours);
    const sample = await this.prisma.weeklyScore.findMany({
      where: { weekStart: new Date(`${this.calendar.localDate(week)}T00:00:00Z`), status: 'FINAL' },
      take: DRY_RUN_SAMPLE,
      select: { userId: true },
    });
    const deltas: number[] = [];
    let before = 0;
    let after = 0;
    for (const { userId } of sample) {
      const a = await this.weekly.compute(userId, week, active.config, active.version);
      const d = await this.weekly.compute(userId, week, parsed.data, version);
      before += a.total;
      after += d.total;
      deltas.push(d.total - a.total);
    }
    const n = sample.length || 1;
    return {
      valid: true,
      issues: [],
      dryRun: {
        week: this.calendar.localDate(week),
        users: sample.length,
        meanTotalActive: round(before / n),
        meanTotalDraft: round(after / n),
        maxIncrease: round(Math.max(0, ...deltas)),
        maxDecrease: round(Math.min(0, ...deltas)),
      },
    };
  }

  /** Atomic switch (one ACTIVE rule set, enforced by the DB); never retroactive (docs §5.2). */
  async activate(actor: AuthUser, version: number) {
    const draft = await this.draft(version);
    const config = ruleSetConfigSchema.parse(draft.config);
    const previous = await this.prisma.scoringRuleSet.findFirst({ where: { status: 'ACTIVE' } });
    await this.prisma.$transaction(async (tx) => {
      await tx.scoringRuleSet.updateMany({ where: { status: 'ACTIVE' }, data: { status: 'ARCHIVED' } });
      await tx.scoringRuleSet.update({ where: { id: draft.id }, data: { status: 'ACTIVE', activatedAt: this.clock.now(), activatedById: actor.id } });
      // Division thresholds live in the rule set; keep the joinable table in sync.
      for (const [code, minLp] of Object.entries(config.division_thresholds)) {
        await tx.division.update({ where: { code: code as keyof typeof config.division_thresholds }, data: { minLp: minLp! } });
      }
      await this.audit.log(
        { actorId: actor.id, actorRole: actor.role, action: 'RULESET_ACTIVATED', entityType: 'scoring_rule_set', entityId: draft.id, before: { version: previous?.version ?? null, config: (previous?.config ?? null) as Prisma.InputJsonValue }, after: { version, config: config as Prisma.InputJsonValue } },
        tx,
      );
    });
    this.ruleSets.invalidate();
    return this.ruleSet(version);
  }

  private async draft(version: number) {
    const r = await this.prisma.scoringRuleSet.findUnique({ where: { version } });
    if (!r) throw AppException.notFound('Rule set');
    if (r.status !== 'DRAFT') throw AppException.conflict(ErrorCode.CONFLICT, 'Published rule sets are immutable: create a new draft.');
    return r;
  }

  // ───────────── Seasons ─────────────

  async seasonList() {
    const rows = await this.prisma.season.findMany({ orderBy: { startsAt: 'desc' }, include: { _count: { select: { standings: true } } } });
    return rows.map((s) => ({ id: s.id, name: s.name, status: s.status, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), closedAt: s.closedAt?.toISOString() ?? null, standings: s._count.standings }));
  }

  async createSeason(actor: AuthUser, dto: CreateSeasonDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) throw AppException.validation([{ field: 'endsAt', code: 'BEFORE_START' }]);
    if (startsAt <= this.clock.now()) throw AppException.validation([{ field: 'startsAt', code: 'MUST_BE_IN_FUTURE' }]);
    const id = uuidv7();
    try {
      await this.prisma.season.create({ data: { id, name: dto.name, startsAt, endsAt, status: 'SCHEDULED' } });
    } catch (err) {
      if (String(err).includes('seasons_no_overlap')) throw AppException.conflict(ErrorCode.CONFLICT, 'Seasons cannot overlap.');
      throw err;
    }
    await this.audit.log({ actorId: actor.id, actorRole: actor.role, action: 'SEASON_SCHEDULED', entityType: 'season', entityId: id, after: { name: dto.name, startsAt: dto.startsAt, endsAt: dto.endsAt } });
    return this.prisma.season.findUniqueOrThrow({ where: { id } });
  }

  async closeSeason(actor: AuthUser, id: string) {
    const s = await this.prisma.season.findUnique({ where: { id } });
    if (!s || s.status !== 'ACTIVE') throw AppException.conflict(ErrorCode.CONFLICT, 'Only the active season can be closed.');
    await this.audit.log({ actorId: actor.id, actorRole: actor.role, action: 'SEASON_CLOSE_REQUESTED', entityType: 'season', entityId: id });
    return this.seasons.closeSeason(id);
  }

  // ───────────── Catalog ─────────────

  async upsertSport(actor: AuthUser, dto: SportDto) {
    const fields = { category: dto.category, loggingMode: dto.loggingMode, nameI18n: dto.name, enabled: dto.enabled ?? true };
    const sport = await this.prisma.sport.upsert({ where: { code: dto.code }, update: fields, create: { id: uuidv7(), code: dto.code, ...fields } });
    await this.audit.log({ actorId: actor.id, actorRole: actor.role, action: 'SPORT_UPSERTED', entityType: 'sport', entityId: sport.id, after: fields as Prisma.InputJsonValue });
    return sport;
  }

  async upsertExercise(actor: AuthUser, dto: ExerciseDto) {
    const known = new Set((await this.prisma.metricType.findMany()).map((m) => m.code));
    const unknown = dto.trackedMetrics.filter((m) => !known.has(m));
    if (unknown.length) throw AppException.validation([{ field: 'trackedMetrics', code: 'UNKNOWN_METRIC', params: { unknown } }]);
    const fields = { sportId: dto.sportId ?? null, nameI18n: dto.name, isBodyweight: dto.isBodyweight, trackedMetrics: dto.trackedMetrics, plausibility: dto.plausibility ?? {}, enabled: dto.enabled ?? true };
    const ex = await this.prisma.exercise.upsert({ where: { code: dto.code }, update: fields, create: { id: uuidv7(), code: dto.code, ...fields } });
    await this.audit.log({ actorId: actor.id, actorRole: actor.role, action: 'EXERCISE_UPSERTED', entityType: 'exercise', entityId: ex.id, after: fields as Prisma.InputJsonValue });
    return ex;
  }

  // ───────────── Audit & ledger ─────────────

  async auditLogs(q: AuditQueryDto) {
    const c = q.cursor ? this.cursors.decode<{ id: string }>(q.cursor) : null;
    const rows = await this.prisma.auditLog.findMany({
      where: { entityType: q.entityType, actorId: q.actorId, action: q.action, ...(c && { id: { lt: c.id } }) },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const page = toPage(rows, q.limit, (r) => ({ id: r.id }), (k) => this.cursors.encode(k));
    return { data: page.data.map((a) => ({ id: a.id, action: a.action, actorId: a.actorId, actorRole: a.actorRole, entityType: a.entityType, entityId: a.entityId, before: a.before, after: a.after, at: a.createdAt.toISOString() })), page: page.page };
  }

  /** Manual correction, always a new ledger entry (never an edit) with the reason in the audit log. */
  async recompute(actor: AuthUser, dto: RecomputeDto) {
    const from = this.calendar.weekStart(new Date(`${dto.from.slice(0, 10)}T12:00:00Z`));
    const to = this.calendar.weekStart(new Date(`${dto.to.slice(0, 10)}T12:00:00Z`));
    if (to <= from) throw AppException.validation([{ field: 'to', code: 'INVALID_RANGE' }]);
    // Only closed weeks: the running week is still provisional.
    if (to.getTime() > this.seasons.lastClosableWeek(this.clock.now(), (await this.ruleSets.getActive()).config.week_grace_hours).getTime() + 7 * 86_400_000) {
      throw AppException.validation([{ field: 'to', code: 'WEEK_NOT_CLOSED' }]);
    }
    const dryRun = dto.dryRun !== false;
    const result = await this.seasons.recomputeRange(from, to, dryRun);
    await this.audit.log({ actorId: actor.id, actorRole: actor.role, action: dryRun ? 'SCORES_RECOMPUTE_DRY_RUN' : 'SCORES_RECOMPUTED', entityType: 'weekly_scores', after: { from: dto.from, to: dto.to, reason: dto.reason, weeks: result.weeks, changed: result.changed, lpDelta: result.lpDelta } });
    return { dryRun, ...result };
  }

  async adjust(actor: AuthUser, dto: LedgerAdjustmentDto) {
    const { version, config } = await this.ruleSets.getActive();
    const target = await this.prisma.user.findUnique({ where: { id: dto.userId }, include: { stats: true } });
    if (!target) throw AppException.notFound('User');
    const now = this.clock.now();
    const sourceId = uuidv7();
    const explanation = { formula: 'admin_adjustment', inputs: { reason: dto.reason, by: actor.id }, result: dto.amount };
    const id = await this.prisma.$transaction(async (tx) => {
      let entryId: string;
      if (dto.kind === 'XP') {
        entryId = (await this.ledger.appendXp(tx, { userId: dto.userId, amount: dto.amount, reason: 'ADMIN_ADJUSTMENT', sourceType: 'admin', sourceId, ruleSetVersion: version, effectiveAt: now, explanation, createdById: actor.id }, config)).id;
      } else {
        const seasonId = target.stats?.currentSeasonId;
        if (!seasonId) throw new AppException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, 'User has no current season.');
        entryId = await this.ledger.appendLp(tx, { userId: dto.userId, seasonId, amount: dto.amount, reason: 'ADMIN_ADJUSTMENT', sourceType: 'admin', sourceId, ruleSetVersion: version, effectiveAt: now, explanation, createdById: actor.id }, config.division_thresholds);
      }
      await this.audit.log({ actorId: actor.id, actorRole: actor.role, action: `LEDGER_${dto.kind}_ADJUSTED`, entityType: 'user', entityId: dto.userId, after: { amount: dto.amount, reason: dto.reason, entryId } }, tx);
      return entryId;
    });
    const stats = await this.prisma.userStats.findUniqueOrThrow({ where: { userId: dto.userId } });
    return { entryId: id, xpTotal: Number(stats.xpTotal), seasonLp: stats.seasonLp, division: divisionFor(stats.seasonLp, config.division_thresholds) };
  }
}

function hash(v: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(v)).digest();
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
