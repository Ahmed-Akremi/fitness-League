import { HttpStatus, Injectable } from '@nestjs/common';
import { CompetitionStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser, JUDGE_ROLES } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AnnouncementDto,
  AssignmentDto,
  CategoryDto,
  CompetitionDto,
  CouponCheckDto,
  CouponDto,
  ListCompetitionsQueryDto,
  PrizeDto,
  RegisterDto,
  ReorderDto,
  StaffDto,
  SubmissionDto,
  UpdateCategoryDto,
  UpdateCompetitionDto,
  WorkoutDto,
} from './competitions.dto';
import { canRegister, canSubmit, checkCoupon, checkEligibility, quote, rawValue, youtubeId, type CouponRule, type ScoreType } from './domain';
import { JudgingService } from './judging.service';

type Tx = Prisma.TransactionClient;
const date = (s?: string | null) => (s ? new Date(s) : undefined);

/** Initial category templates (§10). Organizers edit them or create their own. */
export const CATEGORY_TEMPLATES: Omit<CategoryDto, 'active'>[] = [
  { name: 'Rookie Male Division All Ages', gender: 'MALE', level: 'ROOKIE' },
  { name: 'Rookie Female Division All Ages', gender: 'FEMALE', level: 'ROOKIE' },
  { name: 'RX Female Division 18-35', gender: 'FEMALE', minAge: 18, maxAge: 35, level: 'RX' },
  { name: 'RX Masters Female Division 35+', gender: 'FEMALE', minAge: 35, level: 'RX' },
  { name: 'RX Male Division 18-35', gender: 'MALE', minAge: 18, maxAge: 35, level: 'RX' },
  { name: 'RX Master Male Division 35-40', gender: 'MALE', minAge: 35, maxAge: 40, level: 'RX' },
  { name: 'RX Master Male Division 40+', gender: 'MALE', minAge: 40, level: 'RX' },
  { name: 'Intermediate Female Division 18-35', gender: 'FEMALE', minAge: 18, maxAge: 35, level: 'INTERMEDIATE' },
  { name: 'Intermediate Master Female Division 35+', gender: 'FEMALE', minAge: 35, level: 'INTERMEDIATE' },
  { name: 'Intermediate Male Division 18-35', gender: 'MALE', minAge: 18, maxAge: 35, level: 'INTERMEDIATE' },
  { name: 'Intermediate Master Male Division 35-40', gender: 'MALE', minAge: 35, maxAge: 40, level: 'INTERMEDIATE' },
  { name: 'Intermediate Master Male Division 40+', gender: 'MALE', minAge: 40, level: 'INTERMEDIATE' },
  { name: 'Scaled Female Division 18-35', gender: 'FEMALE', minAge: 18, maxAge: 35, level: 'SCALED' },
  { name: 'Scaled Master Female Division 35+', gender: 'FEMALE', minAge: 35, level: 'SCALED' },
  { name: 'Scaled Male Division 18-35', gender: 'MALE', minAge: 18, maxAge: 35, level: 'SCALED' },
  { name: 'Scaled Master Male Division 35-40', gender: 'MALE', minAge: 35, maxAge: 40, level: 'SCALED' },
  { name: 'Scaled Master Male Division 40-45', gender: 'MALE', minAge: 40, maxAge: 45, level: 'SCALED' },
  { name: 'Scaled Master Male Division 45+', gender: 'MALE', minAge: 45, level: 'SCALED' },
];

/** Allowed status moves; CANCELLED from anywhere before the final leaderboard. */
const NEXT: Record<CompetitionStatus, CompetitionStatus[]> = {
  DRAFT: ['REGISTRATION_OPEN', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'CANCELLED'],
  REGISTRATION_CLOSED: ['REGISTRATION_OPEN', 'ACTIVE', 'SUBMISSION_OPEN', 'CANCELLED'],
  ACTIVE: ['SUBMISSION_OPEN', 'JUDGING', 'CANCELLED'],
  SUBMISSION_OPEN: ['JUDGING', 'CANCELLED'],
  JUDGING: ['PROVISIONAL_LEADERBOARD', 'CANCELLED'],
  PROVISIONAL_LEADERBOARD: ['JUDGING', 'CANCELLED'], // FINAL_LEADERBOARD only through publish (head judge)
  FINAL_LEADERBOARD: ['FINISHED'],
  FINISHED: [],
  CANCELLED: [],
};

@Injectable()
export class CompetitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly notifications: NotificationsService,
    private readonly judging: JudgingService,
  ) {}

  // ───────────── Competitions ─────────────

  async list(user: AuthUser, q: ListCompetitionsQueryDto) {
    const now = this.clock.now();
    const where: Prisma.CompetitionWhereInput = { deletedAt: null, status: { not: 'DRAFT' } };
    if (q.mine === 'true') {
      delete where.status;
      where.OR = [{ registrations: { some: { userId: user.id } } }, { staff: { some: { userId: user.id } } }];
    }
    switch (q.filter) {
      case 'REGISTRATION_OPEN':
        where.status = 'REGISTRATION_OPEN';
        break;
      case 'UPCOMING':
        where.eventStart = { gt: now };
        where.status = { notIn: ['DRAFT', 'CANCELLED'] };
        break;
      case 'ACTIVE':
        where.status = { in: ['ACTIVE', 'SUBMISSION_OPEN', 'JUDGING', 'PROVISIONAL_LEADERBOARD'] };
        break;
      case 'FINISHED':
        where.status = { in: ['FINAL_LEADERBOARD', 'FINISHED'] };
        break;
    }
    const rows = await this.prisma.competition.findMany({
      where,
      orderBy: { eventStart: 'asc' },
      take: 100,
      include: { _count: { select: { registrations: { where: { registrationStatus: 'CONFIRMED' } } } } },
    });
    return rows.map((c) => this.card(c, c._count.registrations));
  }

  /** Admin panel: every competition, drafts included. */
  async listAll() {
    const rows = await this.prisma.competition.findMany({
      where: { deletedAt: null },
      orderBy: { eventStart: 'desc' },
      take: 200,
      include: { _count: { select: { registrations: { where: { registrationStatus: 'CONFIRMED' } } } } },
    });
    return rows.map((c) => this.card(c, c._count.registrations));
  }

  async get(user: AuthUser, id: string) {
    const c = await this.prisma.competition.findFirst({
      where: { id, deletedAt: null },
      include: {
        categories: { orderBy: { sortOrder: 'asc' } },
        workouts: { where: { active: true }, orderBy: { number: 'asc' }, include: { variants: true } },
        prizes: { orderBy: [{ categoryId: 'asc' }, { position: 'asc' }] },
        createdBy: { select: { id: true, username: true, profile: { select: { fullName: true } } } },
        _count: { select: { registrations: { where: { registrationStatus: 'CONFIRMED' } } } },
      },
    });
    if (!c) throw AppException.notFound('Competition');
    const roles = [...(await this.judging.roles(id, user.id))];
    const staff = roles.length > 0 || this.judging.isPlatformAdmin(user);
    if (c.status === 'DRAFT' && !staff) throw AppException.notFound('Competition');
    const registration = await this.prisma.competitionRegistration.findUnique({ where: { competitionId_userId: { competitionId: id, userId: user.id } } });
    const now = this.clock.now();
    return {
      ...this.card(c, c._count.registrations),
      description: c.description,
      organizer: { id: c.createdBy.id, username: c.createdBy.username, fullName: c.createdBy.profile?.fullName },
      deadlines: {
        registrationStart: c.registrationStart,
        registrationEnd: c.registrationEnd,
        scoreSubmissionStart: c.scoreSubmissionStart,
        scoreSubmissionDeadline: c.scoreSubmissionDeadline,
        judgingDeadline: c.judgingDeadline,
        appealDeadline: c.appealDeadline,
        leaderboardPublicationAt: c.leaderboardPublicationAt,
      },
      tieBreakRules: c.tieBreakRules,
      categories: c.categories.map((cat) => ({ ...cat, price: cat.registrationPriceOverride ?? c.registrationPrice })),
      // WOD details stay hidden until their release date, except for staff.
      workouts: c.workouts.filter((w) => staff || !w.releaseAt || w.releaseAt <= now),
      prizes: c.prizes,
      myRoles: roles,
      myRegistration: registration,
      serverTime: now,
    };
  }

  async create(user: AuthUser, dto: CompetitionDto) {
    if (!this.judging.isPlatformAdmin(user) && user.role !== 'GYM_ADMIN') throw AppException.forbidden('Organizers only');
    this.checkDates(dto);
    return this.prisma.$transaction(async (tx) => {
      if (await tx.competition.findUnique({ where: { slug: dto.slug } })) throw AppException.validation([{ field: 'slug', code: 'TAKEN' }]);
      const id = uuidv7();
      const c = await tx.competition.create({ data: { id, ...this.data(dto), createdById: user.id } as Prisma.CompetitionUncheckedCreateInput });
      await tx.competitionStaff.create({ data: { id: uuidv7(), competitionId: id, userId: user.id, role: 'ORGANIZER' } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.created', entityType: 'Competition', entityId: id, after: { title: c.title, price: c.registrationPrice, currency: c.currency } }, tx);
      return c;
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateCompetitionDto) {
    await this.judging.requireRole(user, id, ['ORGANIZER']);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.competition.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw AppException.notFound('Competition');
      if (before.leaderboardLockedAt && !this.judging.isPlatformAdmin(user)) throw AppException.forbidden('The competition is final');
      const merged = { ...this.plain(before), ...dto };
      this.checkDates(merged as Partial<CompetitionDto>);
      const c = await tx.competition.update({ where: { id }, data: this.data(dto) as Prisma.CompetitionUncheckedUpdateInput });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.modified', entityType: 'Competition', entityId: id, before: this.plain(before), after: { ...dto } }, tx);
      return c;
    });
  }

  async setStatus(user: AuthUser, id: string, status: CompetitionStatus) {
    await this.judging.requireRole(user, id, ['ORGANIZER']);
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.competition.findFirst({ where: { id, deletedAt: null } });
      if (!c) throw AppException.notFound('Competition');
      if (!NEXT[c.status].includes(status)) throw AppException.conflict(ErrorCode.PRECONDITION_FAILED, `Cannot move from ${c.status} to ${status}`);
      if (status === 'REGISTRATION_OPEN' && (await tx.competitionCategory.count({ where: { competitionId: id, active: true } })) === 0) {
        throw AppException.conflict(ErrorCode.PRECONDITION_FAILED, 'Add at least one active category first');
      }
      const updated = await tx.competition.update({ where: { id }, data: { status } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.status', entityType: 'Competition', entityId: id, before: { status: c.status }, after: { status } }, tx);
      if (status === 'SUBMISSION_OPEN' || status === 'ACTIVE') {
        const athletes = await tx.competitionRegistration.findMany({ where: { competitionId: id, registrationStatus: 'CONFIRMED' }, select: { userId: true } });
        for (const a of athletes) await this.notifications.notify(tx, a.userId, 'COMPETITION_WOD_AVAILABLE', { competitionId: id, title: c.title });
      }
      return updated;
    });
  }

  async remove(user: AuthUser, id: string) {
    await this.judging.requireRole(user, id, ['ORGANIZER']);
    await this.prisma.$transaction(async (tx) => {
      const paid = await tx.competitionRegistration.count({ where: { competitionId: id, paymentStatus: 'PAID' } });
      if (paid > 0) throw AppException.conflict(ErrorCode.PRECONDITION_FAILED, 'Cancel the competition instead: athletes have paid');
      await tx.competition.update({ where: { id }, data: { deletedAt: this.clock.now() } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.deleted', entityType: 'Competition', entityId: id }, tx);
    });
  }

  /** Organizer dashboard figures (§40). Revenue counts PAID registrations only. */
  async dashboard(user: AuthUser, id: string) {
    await this.judging.requireRole(user, id, ['ORGANIZER', 'HEAD_JUDGE']);
    const [regs, subs] = await Promise.all([
      this.prisma.competitionRegistration.groupBy({ by: ['paymentStatus', 'registrationStatus'], where: { competitionId: id }, _count: true, _sum: { finalPrice: true } }),
      this.prisma.competitionSubmission.groupBy({ by: ['status'], where: { workout: { competitionId: id } }, _count: true }),
    ]);
    const count = (f: (r: (typeof regs)[number]) => boolean) => regs.filter(f).reduce((s, r) => s + r._count, 0);
    const subCount = (statuses: string[]) => subs.filter((s) => statuses.includes(s.status)).reduce((s, r) => s + r._count, 0);
    return {
      participants: count((r) => r.registrationStatus === 'CONFIRMED'),
      paidRegistrations: count((r) => r.paymentStatus === 'PAID'),
      freeRegistrations: count((r) => r.paymentStatus === 'FREE'),
      pendingPayments: count((r) => r.paymentStatus === 'PENDING'),
      revenue: regs.filter((r) => r.paymentStatus === 'PAID').reduce((s, r) => s + (r._sum.finalPrice ?? 0), 0),
      pendingSubmissions: subCount(['SUBMITTED']),
      pendingJudging: subCount(['UNDER_REVIEW', 'SUBMITTED']),
      approvedSubmissions: subCount(['FINAL', 'APPROVED']),
      rejectedSubmissions: subCount(['REJECTED']),
    };
  }

  // ───────────── Categories ─────────────

  async addCategory(user: AuthUser, competitionId: string, dto: CategoryDto) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    this.checkAges(dto.minAge, dto.maxAge);
    const cat = await this.prisma.competitionCategory.create({ data: { id: uuidv7(), competitionId, ...dto } });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.category.created', entityType: 'CompetitionCategory', entityId: cat.id, after: { ...dto } });
    return cat;
  }

  /** Adds the 18 template categories (§10); the organizer edits or deactivates them afterwards. */
  async addTemplateCategories(user: AuthUser, competitionId: string) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    const existing = await this.prisma.competitionCategory.count({ where: { competitionId } });
    await this.prisma.competitionCategory.createMany({ data: CATEGORY_TEMPLATES.map((t, i) => ({ id: uuidv7(), competitionId, ...t, sortOrder: existing + i })) });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.category.templates', entityType: 'Competition', entityId: competitionId });
    return this.prisma.competitionCategory.findMany({ where: { competitionId }, orderBy: { sortOrder: 'asc' } });
  }

  async updateCategory(user: AuthUser, competitionId: string, categoryId: string, dto: UpdateCategoryDto) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    const before = await this.prisma.competitionCategory.findFirst({ where: { id: categoryId, competitionId } });
    if (!before) throw AppException.notFound('Category');
    this.checkAges(dto.minAge === undefined ? before.minAge : dto.minAge, dto.maxAge === undefined ? before.maxAge : dto.maxAge);
    const cat = await this.prisma.competitionCategory.update({ where: { id: categoryId }, data: dto });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.category.modified', entityType: 'CompetitionCategory', entityId: categoryId, before: { ...before, createdAt: undefined, updatedAt: undefined }, after: { ...dto } });
    return cat;
  }

  async removeCategory(user: AuthUser, competitionId: string, categoryId: string) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    if (await this.prisma.competitionRegistration.count({ where: { categoryId } })) throw AppException.conflict(ErrorCode.PRECONDITION_FAILED, 'Athletes are registered: deactivate it instead');
    await this.prisma.competitionCategory.delete({ where: { id: categoryId } });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.category.deleted', entityType: 'CompetitionCategory', entityId: categoryId });
  }

  // ───────────── WODs ─────────────

  async addWorkout(user: AuthUser, competitionId: string, dto: WorkoutDto) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    this.checkWorkout(dto);
    return this.prisma.$transaction(async (tx) => {
      const id = uuidv7();
      const { variants, ...fields } = dto;
      const w = await tx.competitionWorkout.create({ data: { id, competitionId, ...this.workoutData(fields) } as Prisma.CompetitionWorkoutUncheckedCreateInput });
      for (const v of variants ?? []) await tx.competitionWorkoutVariant.create({ data: { id: uuidv7(), workoutId: id, ...v } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.wod.created', entityType: 'CompetitionWorkout', entityId: id, after: { name: w.name, maximumPoints: w.maximumPoints, scoringMethod: w.scoringMethod } }, tx);
      return w;
    });
  }

  async updateWorkout(user: AuthUser, competitionId: string, workoutId: string, dto: WorkoutDto) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    this.checkWorkout(dto);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.competitionWorkout.findFirst({ where: { id: workoutId, competitionId } });
      if (!before) throw AppException.notFound('WOD');
      const { variants, ...fields } = dto;
      const w = await tx.competitionWorkout.update({ where: { id: workoutId }, data: this.workoutData(fields) as Prisma.CompetitionWorkoutUncheckedUpdateInput });
      if (variants) {
        await tx.competitionWorkoutVariant.deleteMany({ where: { workoutId } });
        for (const v of variants) await tx.competitionWorkoutVariant.create({ data: { id: uuidv7(), workoutId, ...v } });
      }
      // Points rules may have changed: every category's official totals follow.
      for (const c of await tx.competitionCategory.findMany({ where: { competitionId }, select: { id: true } })) await this.judging.recompute(tx, competitionId, c.id);
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.wod.modified', entityType: 'CompetitionWorkout', entityId: workoutId, before: { name: before.name, maximumPoints: before.maximumPoints, scoringMethod: before.scoringMethod }, after: { ...fields } }, tx);
      return w;
    });
  }

  async removeWorkout(user: AuthUser, competitionId: string, workoutId: string) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    if (await this.prisma.competitionSubmission.count({ where: { workoutId } })) throw AppException.conflict(ErrorCode.PRECONDITION_FAILED, 'Scores exist: deactivate the WOD instead');
    await this.prisma.competitionWorkout.delete({ where: { id: workoutId } });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.wod.deleted', entityType: 'CompetitionWorkout', entityId: workoutId });
  }

  async reorderWorkouts(user: AuthUser, competitionId: string, dto: ReorderDto) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    await this.prisma.$transaction(async (tx) => {
      // Two passes to avoid the (competitionId, number) unique constraint while renumbering.
      for (const [i, id] of dto.workoutIds.entries()) await tx.competitionWorkout.update({ where: { id, competitionId }, data: { number: 1000 + i } });
      for (const [i, id] of dto.workoutIds.entries()) await tx.competitionWorkout.update({ where: { id, competitionId }, data: { number: i + 1 } });
    });
    return this.prisma.competitionWorkout.findMany({ where: { competitionId }, orderBy: { number: 'asc' } });
  }

  // ───────────── Staff, prizes, coupons, announcements ─────────────

  /**
   * Organizers manage the whole staff; head judges manage the judges and head judges. Judges and head judges
   * must be judge accounts (created by admins), which never compete.
   */
  async addStaff(user: AuthUser, competitionId: string, dto: StaffDto) {
    await this.judging.requireRole(user, competitionId, dto.role === 'ORGANIZER' ? ['ORGANIZER'] : ['ORGANIZER', 'HEAD_JUDGE']);
    if (dto.role !== 'ORGANIZER') {
      const target = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { role: true } });
      if (!target) throw AppException.notFound('User');
      if (dto.role === 'HEAD_JUDGE' ? target.role !== 'HEAD_JUDGE' : !JUDGE_ROLES.includes(target.role)) {
        throw AppException.forbidden(dto.role === 'HEAD_JUDGE' ? 'Head judge accounts only' : 'Judge accounts only');
      }
    }
    const staff = await this.prisma.competitionStaff.upsert({
      where: { competitionId_userId_role: { competitionId, userId: dto.userId, role: dto.role } },
      create: { id: uuidv7(), competitionId, userId: dto.userId, role: dto.role },
      update: {},
    });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.staff.added', entityType: 'CompetitionStaff', entityId: staff.id, after: { ...dto } });
    return staff;
  }

  async listStaff(user: AuthUser, competitionId: string) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER', 'HEAD_JUDGE']);
    return this.prisma.competitionStaff.findMany({ where: { competitionId }, include: { assignments: true, user: { select: { username: true, profile: { select: { fullName: true } } } } } });
  }

  async removeStaff(user: AuthUser, competitionId: string, staffId: string) {
    const staff = await this.prisma.competitionStaff.findFirst({ where: { id: staffId, competitionId } });
    if (!staff) throw AppException.notFound('Staff');
    await this.judging.requireRole(user, competitionId, staff.role === 'ORGANIZER' ? ['ORGANIZER'] : ['ORGANIZER', 'HEAD_JUDGE']);
    await this.prisma.competitionStaff.delete({ where: { id: staffId, competitionId } });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.staff.removed', entityType: 'CompetitionStaff', entityId: staffId });
  }

  async assign(user: AuthUser, competitionId: string, dto: AssignmentDto) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER', 'HEAD_JUDGE']);
    const staff = await this.prisma.competitionStaff.findFirst({ where: { id: dto.staffId, competitionId, role: { in: ['JUDGE', 'HEAD_JUDGE'] } } });
    if (!staff) throw AppException.notFound('Judge');
    const a = await this.prisma.competitionJudgeAssignment.create({ data: { id: uuidv7(), staffId: dto.staffId, categoryId: dto.categoryId ?? null, workoutId: dto.workoutId ?? null } });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.judge.assigned', entityType: 'CompetitionJudgeAssignment', entityId: a.id, after: { ...dto } });
    return a;
  }

  async addPrize(user: AuthUser, competitionId: string, dto: PrizeDto) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    const c = await this.prisma.competition.findUniqueOrThrow({ where: { id: competitionId } });
    const prize = await this.prisma.competitionPrize.create({ data: { id: uuidv7(), competitionId, ...dto, currency: dto.amount != null ? (dto.currency ?? c.currency) : null } });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.prize.created', entityType: 'CompetitionPrize', entityId: prize.id, after: { ...dto } });
    return prize;
  }

  async removePrize(user: AuthUser, competitionId: string, prizeId: string) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    await this.prisma.competitionPrize.delete({ where: { id: prizeId, competitionId } });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.prize.deleted', entityType: 'CompetitionPrize', entityId: prizeId });
  }

  async addCoupon(user: AuthUser, competitionId: string, dto: CouponDto) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    if (dto.type === 'PERCENTAGE' && !(dto.value != null && dto.value >= 1 && dto.value <= 100)) throw AppException.validation([{ field: 'value', code: 'PERCENTAGE_1_100' }]);
    if (dto.type === 'FIXED_AMOUNT' && !(dto.value != null && dto.value > 0)) throw AppException.validation([{ field: 'value', code: 'POSITIVE' }]);
    if (await this.prisma.competitionCoupon.findUnique({ where: { competitionId_code: { competitionId, code: dto.code } } })) throw AppException.validation([{ field: 'code', code: 'TAKEN' }]);
    const coupon = await this.prisma.competitionCoupon.create({ data: { id: uuidv7(), competitionId, ...dto, value: dto.value ?? 0, expiresAt: date(dto.expiresAt) } });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.coupon.created', entityType: 'CompetitionCoupon', entityId: coupon.id, after: { code: dto.code, type: dto.type, value: dto.value ?? 0 } });
    return coupon;
  }

  async listCoupons(user: AuthUser, competitionId: string) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    return this.prisma.competitionCoupon.findMany({ where: { competitionId }, orderBy: { createdAt: 'desc' } });
  }

  async setCouponActive(user: AuthUser, competitionId: string, couponId: string, active: boolean) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    const c = await this.prisma.competitionCoupon.update({ where: { id: couponId, competitionId }, data: { active } });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.coupon.modified', entityType: 'CompetitionCoupon', entityId: couponId, after: { active } });
    return c;
  }

  async announce(user: AuthUser, competitionId: string, dto: AnnouncementDto) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    return this.prisma.competitionAnnouncement.create({ data: { id: uuidv7(), competitionId, ...dto, createdById: user.id } });
  }

  announcements(competitionId: string) {
    return this.prisma.competitionAnnouncement.findMany({ where: { competitionId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  // ───────────── Registration ─────────────

  /** Price preview with an optional coupon; the same checks run again (in a transaction) when registering. */
  async checkCouponCode(user: AuthUser, competitionId: string, dto: CouponCheckDto) {
    const c = await this.prisma.competition.findFirst({ where: { id: competitionId, deletedAt: null } });
    const category = await this.prisma.competitionCategory.findFirst({ where: { id: dto.categoryId, competitionId } });
    if (!c || !category) throw AppException.notFound('Category');
    const coupon = await this.findCoupon(this.prisma, competitionId, dto.code);
    const amount = category.registrationPriceOverride ?? c.registrationPrice;
    const used = coupon ? await this.prisma.competitionCouponRedemption.count({ where: { couponId: coupon.id, userId: user.id } }) : 0;
    const refusal = coupon ? checkCoupon(coupon, { competitionId, categoryId: category.id, amount, now: this.clock.now(), alreadyUsedByAthlete: used > 0 }) : 'COUPON_INACTIVE';
    if (refusal) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_FAILED, 'Coupon refused', { errors: [{ field: 'code', code: refusal }] });
    return { ...quote(c.registrationPrice, category.registrationPriceOverride, coupon), currency: c.currency };
  }

  async register(user: AuthUser, competitionId: string, dto: RegisterDto) {
    return this.prisma.$transaction(async (tx) => {
      // Serialize registrations of a competition: capacity, coupon uses and duplicates stay exact.
      await tx.$executeRaw`SELECT 1 FROM competitions WHERE id = ${competitionId}::uuid FOR UPDATE`;
      const c = await tx.competition.findFirst({ where: { id: competitionId, deletedAt: null } });
      if (!c) throw AppException.notFound('Competition');
      const now = this.clock.now();
      if (canRegister(c, now)) throw new AppException(HttpStatus.CONFLICT, ErrorCode.PRECONDITION_FAILED, 'Registration is closed');
      if (await tx.competitionRegistration.findUnique({ where: { competitionId_userId: { competitionId, userId: user.id } } })) throw AppException.conflict(ErrorCode.CONFLICT, 'Already registered');
      const category = await tx.competitionCategory.findFirst({ where: { id: dto.categoryId, competitionId } });
      if (!category) throw AppException.notFound('Category');
      if (c.maxParticipants != null && (await tx.competitionRegistration.count({ where: { competitionId, registrationStatus: { in: ['PENDING', 'CONFIRMED'] } } })) >= c.maxParticipants) {
        throw AppException.conflict(ErrorCode.PRECONDITION_FAILED, 'The competition is full');
      }
      const athlete = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { dateOfBirth: true, profile: { select: { gender: true } } } });
      const registeredCount = await tx.competitionRegistration.count({ where: { categoryId: category.id, registrationStatus: { in: ['PENDING', 'CONFIRMED'] } } });
      const refusal = checkEligibility(category, { gender: athlete.profile?.gender ?? null, dateOfBirth: athlete.dateOfBirth }, { referenceDate: c.eventStart, registeredCount });
      if (refusal) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_FAILED, 'Not eligible for this category', { errors: [{ field: 'categoryId', code: refusal }] });

      let coupon: (CouponRule & { id: string }) | null = null;
      if (dto.couponCode) {
        coupon = await this.findCoupon(tx, competitionId, dto.couponCode);
        const used = coupon ? await tx.competitionCouponRedemption.count({ where: { couponId: coupon.id, userId: user.id } }) : 0;
        const amount = category.registrationPriceOverride ?? c.registrationPrice;
        const couponRefusal = coupon ? checkCoupon(coupon, { competitionId, categoryId: category.id, amount, now, alreadyUsedByAthlete: used > 0 }) : 'COUPON_INACTIVE';
        if (couponRefusal) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_FAILED, 'Coupon refused', { errors: [{ field: 'couponCode', code: couponRefusal }] });
      }
      const price = quote(c.registrationPrice, category.registrationPriceOverride, coupon);
      const free = price.paymentStatus === 'FREE';
      const id = uuidv7();
      const registration = await tx.competitionRegistration.create({
        data: {
          id,
          competitionId,
          categoryId: category.id,
          userId: user.id,
          registrationStatus: free ? 'CONFIRMED' : 'PENDING',
          paymentStatus: free ? 'FREE' : 'PENDING',
          originalPrice: price.originalPrice,
          discount: price.discount,
          finalPrice: price.finalPrice,
          currency: c.currency,
          couponId: coupon?.id ?? null,
        },
      });
      if (coupon) {
        // Guarded increment: never exceeds maxUses even under concurrent registrations.
        const ok = await tx.competitionCoupon.updateMany({ where: { id: coupon.id, OR: [{ maxUses: null }, { usedCount: { lt: coupon.maxUses ?? 0 } }] }, data: { usedCount: { increment: 1 } } });
        if (ok.count === 0) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_FAILED, 'Coupon refused', { errors: [{ field: 'couponCode', code: 'COUPON_EXHAUSTED' }] });
        await tx.competitionCouponRedemption.create({ data: { id: uuidv7(), couponId: coupon.id, registrationId: id, userId: user.id, discount: price.discount } });
        await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.coupon.used', entityType: 'CompetitionCoupon', entityId: coupon.id, after: { registrationId: id, discount: price.discount } }, tx);
      }
      await tx.competitionPayment.create({ data: { id: uuidv7(), registrationId: id, amount: price.finalPrice, currency: c.currency, status: free ? 'FREE' : 'PENDING', provider: free ? 'NONE' : 'MANUAL' } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.registration.created', entityType: 'CompetitionRegistration', entityId: id, after: { categoryId: category.id, ...price } }, tx);
      if (free) {
        await this.judging.recompute(tx, competitionId, category.id);
        await this.notifications.notify(tx, user.id, 'COMPETITION_REGISTRATION_CONFIRMED', { competitionId, title: c.title });
      }
      return { ...registration, price };
    });
  }

  /** No payment provider yet (decided default): the organizer records a payment received offline. */
  async markPaid(user: AuthUser, competitionId: string, registrationId: string) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.competitionRegistration.findFirst({ where: { id: registrationId, competitionId }, include: { competition: { select: { title: true } } } });
      if (!r) throw AppException.notFound('Registration');
      if (r.paymentStatus !== 'PENDING') throw AppException.conflict(ErrorCode.CONFLICT, 'Nothing to pay');
      await tx.competitionPayment.create({ data: { id: uuidv7(), registrationId, amount: r.finalPrice, currency: r.currency, status: 'PAID', provider: 'MANUAL', recordedById: user.id } });
      const updated = await tx.competitionRegistration.update({ where: { id: registrationId }, data: { paymentStatus: 'PAID', registrationStatus: 'CONFIRMED' } });
      await this.judging.recompute(tx, competitionId, r.categoryId);
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.payment.recorded', entityType: 'CompetitionRegistration', entityId: registrationId, before: { paymentStatus: r.paymentStatus }, after: { paymentStatus: 'PAID', amount: r.finalPrice } }, tx);
      await this.notifications.notify(tx, r.userId, 'COMPETITION_REGISTRATION_CONFIRMED', { competitionId, title: r.competition.title });
      return updated;
    });
  }

  async registrations(user: AuthUser, competitionId: string) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER', 'HEAD_JUDGE']);
    return this.prisma.competitionRegistration.findMany({
      where: { competitionId },
      orderBy: { registeredAt: 'asc' },
      include: { category: { select: { name: true } }, user: { select: { username: true, profile: { select: { fullName: true } } } } },
    });
  }

  // ───────────── Submissions ─────────────

  /** Score + YouTube video for one WOD. Idempotent on clientId; resubmission allowed while DRAFT / SUBMITTED / NEEDS_CORRECTION. */
  async submit(user: AuthUser, competitionId: string, workoutId: string, dto: SubmissionDto) {
    return this.prisma.$transaction(async (tx) => {
      const replay = await tx.competitionSubmission.findUnique({ where: { clientId: dto.clientId } });
      if (replay) {
        if (replay.userId !== user.id || replay.workoutId !== workoutId) throw AppException.conflict(ErrorCode.IDEMPOTENCY_CONFLICT);
        return replay;
      }
      const w = await tx.competitionWorkout.findFirst({ where: { id: workoutId, competitionId }, include: { competition: true } });
      if (!w) throw AppException.notFound('WOD');
      const reg = await tx.competitionRegistration.findUnique({ where: { competitionId_userId: { competitionId, userId: user.id } } });
      if (!reg || reg.registrationStatus !== 'CONFIRMED') throw AppException.forbidden('Registered athletes only');
      const now = this.clock.now();
      if (canSubmit(w, w.competition, now)) throw new AppException(HttpStatus.CONFLICT, ErrorCode.WOD_CLOSED, 'Submissions are closed for this WOD');

      const raw = dto.raw as Record<string, number | boolean | null>;
      const value = rawValue(w.scoreType as ScoreType, { ...(raw as object), capS: w.timeCapS } as Parameters<typeof rawValue>[1]);
      if (value == null || !Number.isFinite(value) || value < 0) throw AppException.validation([{ field: 'raw', code: 'SCORE_REQUIRED' }]);
      if (w.scoreType === 'TIME' && !raw.capped && w.timeCapS != null && value > w.timeCapS) throw AppException.validation([{ field: 'raw.timeS', code: 'OVER_TIME_CAP' }]);
      if (w.scoringMethod === 'DIRECT_POINTS' && value > w.maximumPoints) throw AppException.validation([{ field: 'raw.value', code: 'OVER_MAXIMUM_POINTS' }]);
      // The proof is a YouTube link only; drafts may be saved before the video is online.
      const yt = dto.videoUrl ? youtubeId(dto.videoUrl) : null;
      if (dto.videoUrl && !yt) throw AppException.validation([{ field: 'videoUrl', code: 'NOT_A_YOUTUBE_URL' }]);
      const status = dto.submit === false ? 'DRAFT' : 'SUBMITTED';
      if (status === 'SUBMITTED' && !yt) throw AppException.validation([{ field: 'videoUrl', code: 'REQUIRED' }]);

      const existing = await tx.competitionSubmission.findUnique({ where: { workoutId_userId: { workoutId, userId: user.id } }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
      if (existing && !['DRAFT', 'SUBMITTED', 'NEEDS_CORRECTION'].includes(existing.status)) throw AppException.conflict(ErrorCode.CONFLICT, 'This score is being judged');
      const data = { status, raw: dto.raw as Prisma.InputJsonObject, rawValue: value, notes: dto.notes ?? null, videoUrl: dto.videoUrl ?? null, youtubeId: yt, clientId: dto.clientId, submittedAt: now } as const;
      const s = existing
        ? await tx.competitionSubmission.update({ where: { id: existing.id }, data })
        : await tx.competitionSubmission.create({ data: { id: uuidv7(), workoutId, registrationId: reg.id, userId: user.id, ...data } });
      await tx.competitionScoreVersion.create({ data: { id: uuidv7(), submissionId: s.id, version: (existing?.versions[0]?.version ?? 0) + 1, points: 0, rawValue: value, reason: status === 'DRAFT' ? 'Draft saved' : 'Submitted by athlete', judgeId: null } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.score.submitted', entityType: 'CompetitionSubmission', entityId: s.id, after: { workoutId, rawValue: value, status } }, tx);
      if (status === 'SUBMITTED') await this.notifications.notify(tx, user.id, 'COMPETITION_SCORE_SUBMITTED', { competitionId, submissionId: s.id, workoutName: w.name });
      return s;
    });
  }

  async mySubmissions(user: AuthUser, competitionId: string) {
    return this.prisma.competitionSubmission.findMany({
      where: { userId: user.id, workout: { competitionId } },
      include: { workout: { select: { id: true, number: true, name: true, scoreType: true } }, penalties: true },
      orderBy: { workout: { number: 'asc' } },
    });
  }

  // ───────────── helpers ─────────────

  private async findCoupon(tx: Tx, competitionId: string, code: string): Promise<(CouponRule & { id: string }) | null> {
    const c = await tx.competitionCoupon.findUnique({ where: { competitionId_code: { competitionId, code: code.trim().toUpperCase() } } });
    return c ? { ...c, value: c.value } : null;
  }

  private card(c: Prisma.CompetitionGetPayload<object>, participants: number) {
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      shortDescription: c.description.slice(0, 160),
      coverMediaId: c.coverMediaId,
      logoMediaId: c.logoMediaId,
      location: c.location,
      city: c.city,
      countryCode: c.countryCode,
      format: c.format,
      status: c.status,
      eventStart: c.eventStart,
      eventEnd: c.eventEnd,
      registrationEnd: c.registrationEnd,
      registrationPrice: c.registrationPrice,
      currency: c.currency,
      maxParticipants: c.maxParticipants,
      participants,
    };
  }

  private data(dto: Partial<CompetitionDto>) {
    const { tieBreakRules, ...rest } = dto;
    return {
      ...rest,
      registrationStart: date(dto.registrationStart),
      registrationEnd: date(dto.registrationEnd),
      eventStart: date(dto.eventStart),
      eventEnd: date(dto.eventEnd),
      scoreSubmissionStart: date(dto.scoreSubmissionStart),
      scoreSubmissionDeadline: date(dto.scoreSubmissionDeadline),
      judgingDeadline: date(dto.judgingDeadline),
      appealDeadline: date(dto.appealDeadline),
      leaderboardPublicationAt: date(dto.leaderboardPublicationAt),
      ...(tieBreakRules ? { tieBreakRules: tieBreakRules as Prisma.InputJsonArray } : {}),
    };
  }

  private plain(c: Prisma.CompetitionGetPayload<object>) {
    const iso = (d: Date | null) => d?.toISOString();
    return {
      title: c.title,
      registrationPrice: c.registrationPrice,
      currency: c.currency,
      status: c.status,
      registrationStart: iso(c.registrationStart),
      registrationEnd: iso(c.registrationEnd),
      eventStart: iso(c.eventStart),
      eventEnd: iso(c.eventEnd),
    };
  }

  private checkDates(d: Partial<CompetitionDto>) {
    const t = (s?: string) => (s ? new Date(s).getTime() : null);
    const errors: { field: string; code: string }[] = [];
    if (t(d.registrationStart)! >= t(d.registrationEnd)!) errors.push({ field: 'registrationEnd', code: 'BEFORE_START' });
    if (t(d.eventStart)! > t(d.eventEnd)!) errors.push({ field: 'eventEnd', code: 'BEFORE_START' });
    if (d.scoreSubmissionStart && d.scoreSubmissionDeadline && t(d.scoreSubmissionStart)! >= t(d.scoreSubmissionDeadline)!) errors.push({ field: 'scoreSubmissionDeadline', code: 'BEFORE_START' });
    if (d.judgingDeadline && d.scoreSubmissionDeadline && t(d.judgingDeadline)! < t(d.scoreSubmissionDeadline)!) errors.push({ field: 'judgingDeadline', code: 'BEFORE_SUBMISSION_DEADLINE' });
    if (d.appealDeadline && d.judgingDeadline && t(d.appealDeadline)! < t(d.judgingDeadline)!) errors.push({ field: 'appealDeadline', code: 'BEFORE_JUDGING_DEADLINE' });
    if (errors.length) throw AppException.validation(errors);
  }

  private checkAges(min?: number | null, max?: number | null) {
    if (min != null && max != null && min > max) throw AppException.validation([{ field: 'maxAge', code: 'UNDER_MIN_AGE' }]);
  }

  private checkWorkout(dto: WorkoutDto) {
    const errors: { field: string; code: string }[] = [];
    if (new Date(dto.submissionStart) >= new Date(dto.submissionDeadline)) errors.push({ field: 'submissionDeadline', code: 'BEFORE_START' });
    if ((dto.minimumPoints ?? 0) > dto.maximumPoints) errors.push({ field: 'minimumPoints', code: 'OVER_MAXIMUM' });
    if (dto.scoringMethod === 'PLACEMENT_POINTS') {
      const table = dto.placementTable ?? [];
      if (!table.length) errors.push({ field: 'placementTable', code: 'REQUIRED' });
      if (table.some((p, i) => p > dto.maximumPoints || (i > 0 && p > table[i - 1]))) errors.push({ field: 'placementTable', code: 'MUST_DECREASE_WITHIN_MAXIMUM' });
    }
    if (errors.length) throw AppException.validation(errors);
  }

  private workoutData(fields: Omit<WorkoutDto, 'variants'>) {
    return {
      ...fields,
      movements: (fields.movements ?? []) as Prisma.InputJsonArray,
      placementTable: (fields.placementTable ?? []) as Prisma.InputJsonArray,
      releaseAt: date(fields.releaseAt),
      submissionStart: date(fields.submissionStart),
      submissionDeadline: date(fields.submissionDeadline),
    };
  }
}
