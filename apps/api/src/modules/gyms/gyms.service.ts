import { Injectable } from '@nestjs/common';
import { Gym, Media, Prisma, Role } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { CursorCodec } from '../../common/pagination/cursor';
import { PageQueryDto, toPage } from '../../common/pagination/page';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { CreateGymDto, isHttpUrl, ListGymsQueryDto, ReviewGymDto, SOCIAL_LINK_KEYS, UpdateGymDto } from './dto/gym.dto';

const STAFF: Role[] = ['ADMIN', 'SUPER_ADMIN'];

const GYM_CARD_INCLUDE = {
  city: true,
  governorate: true,
  logo: true,
  sports: { include: { sport: true } },
  _count: { select: { members: { where: { status: 'APPROVED' as const } } } },
} satisfies Prisma.GymInclude;
type GymCard = Prisma.GymGetPayload<{ include: typeof GYM_CARD_INCLUDE }>;

/** Gyms, verification and memberships (spec §16.1). Gym Wars arrive in Phase 2. */
@Injectable()
export class GymsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cursors: CursorCodec,
    private readonly clock: ClockService,
    private readonly storage: StorageService,
  ) {}

  // ───────────── Directory ─────────────

  async list(q: ListGymsQueryDto) {
    let sportId: string | undefined;
    if (q.sport) {
      const sport = await this.prisma.sport.findUnique({ where: { code: q.sport } });
      if (!sport) throw AppException.validation([{ field: 'sport', code: 'UNKNOWN_SPORT' }]);
      sportId = sport.id;
    }
    const byMembers = q.sort === 'members';
    const c = q.cursor ? this.cursors.decode<{ n?: string; m?: number; id?: string }>(q.cursor) : null;
    // A cursor only fits the sort it was issued for.
    if (c && (typeof c.id !== 'string' || (byMembers ? typeof c.m !== 'number' : typeof c.n !== 'string'))) {
      throw AppException.validation([{ field: 'cursor', code: 'CURSOR_SORT_MISMATCH' }]);
    }
    // Accent/case-insensitive "contains"; LIKE wildcards typed by the user are matched literally.
    const like = q.q?.trim() ? `%${q.q.trim().toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
    const rows = await this.prisma.$queryRaw<{ id: string; name: string; members: number }[]>`
      SELECT g.id, g.name, COUNT(m.id)::int AS members
      FROM gyms g
      LEFT JOIN gym_members m ON m.gym_id = g.id AND m.status = 'APPROVED'
      WHERE g.status = 'VERIFIED' AND g.deleted_at IS NULL
        ${q.governorateId ? Prisma.sql`AND g.governorate_id = ${q.governorateId}::uuid` : Prisma.empty}
        ${sportId ? Prisma.sql`AND EXISTS (SELECT 1 FROM gym_sports s WHERE s.gym_id = g.id AND s.sport_id = ${sportId}::uuid)` : Prisma.empty}
        ${like ? Prisma.sql`AND lower(f_unaccent(g.name)) LIKE lower(f_unaccent(${like})) ESCAPE '\\'` : Prisma.empty}
      GROUP BY g.id
      ${c ? (byMembers ? Prisma.sql`HAVING (COUNT(m.id)::int, g.id) < (${c.m}::int, ${c.id}::uuid)` : Prisma.sql`HAVING (g.name, g.id) > (${c.n}, ${c.id}::uuid)`) : Prisma.empty}
      ORDER BY ${byMembers ? Prisma.sql`members DESC, g.id DESC` : Prisma.sql`g.name ASC, g.id ASC`}
      LIMIT ${q.limit + 1}`;
    const page = toPage(rows, q.limit, (r) => (byMembers ? { m: r.members, id: r.id } : { n: r.name, id: r.id }), (k) => this.cursors.encode(k));
    const full = await this.prisma.gym.findMany({ where: { id: { in: page.data.map((r) => r.id) } }, include: GYM_CARD_INCLUDE });
    const byId = new Map(full.map((g) => [g.id, g]));
    return { data: page.data.map((r) => this.card(byId.get(r.id)!)), page: page.page };
  }

  /** Public gym profile: city-level location, members count, top athletes of the season. Phone and email stay private. */
  async get(id: string, viewer?: AuthUser) {
    const gym = await this.prisma.gym.findUnique({ where: { id }, include: GYM_CARD_INCLUDE });
    if (!gym || gym.deletedAt || gym.status !== 'VERIFIED') throw AppException.notFound('Gym');
    const top = await this.prisma.userStats.findMany({
      where: { user: { status: 'ACTIVE', profile: { primaryGymId: id } }, season: { status: 'ACTIVE' } },
      orderBy: [{ seasonLp: 'desc' }, { userId: 'asc' }],
      take: 5,
      include: { user: { select: { username: true, profile: { select: { fullName: true } } } } },
    });
    // Gym rank of the active season: sum of the members' season LP.
    const rankRows = await this.prisma.$queryRaw<{ rank: number }[]>`
      WITH totals AS (
        SELECT p.primary_gym_id AS gym_id, SUM(s.season_lp) AS lp
        FROM user_stats s
        JOIN profiles p ON p.user_id = s.user_id
        JOIN seasons se ON se.id = s.current_season_id AND se.status = 'ACTIVE'
        JOIN gyms g ON g.id = p.primary_gym_id AND g.status = 'VERIFIED' AND g.deleted_at IS NULL
        GROUP BY p.primary_gym_id
        HAVING SUM(s.season_lp) > 0)
      SELECT rank::int FROM (SELECT gym_id, RANK() OVER (ORDER BY lp DESC) AS rank FROM totals) r WHERE gym_id = ${id}::uuid`;
    const membership = viewer ? await this.prisma.gymMember.findFirst({ where: { gymId: id, userId: viewer.id, status: { in: ['PENDING', 'APPROVED'] } } }) : null;
    const outcomes = await this.prisma.gymWarParticipant.groupBy({ by: ['outcome'], where: { gymId: id, outcome: { not: null } }, _count: true });
    const wars = (o: string) => outcomes.find((x) => x.outcome === o)?._count ?? 0;
    return {
      ...this.card(gym),
      addressLine: gym.addressLine,
      socialLinks: gym.socialLinks,
      rank: rankRows[0]?.rank ?? null,
      topAthletes: top.map((s) => ({ id: s.userId, username: s.user.username, fullName: s.user.profile?.fullName, lp: s.seasonLp, level: s.level })),
      myMembership: {
        status: membership?.status ?? 'NONE',
        role: membership?.status === 'APPROVED' ? (membership.role === 'COACH' || (viewer && this.canManage(viewer, gym)) ? 'COACH' : 'MEMBER') : null,
      },
      canManage: viewer ? this.canManage(viewer, gym) : false,
      warRecord: { wins: wars('WIN'), losses: wars('LOSS'), draws: wars('DRAW'), rating: Math.round(Number(gym.rating)), enrolled: !gym.warsOptOut },
    };
  }

  private card(g: GymCard) {
    return {
      id: g.id,
      name: g.name,
      slug: g.slug,
      verified: g.status === 'VERIFIED',
      city: g.city.nameI18n,
      governorate: { id: g.governorate.id, code: g.governorate.code, name: g.governorate.nameI18n },
      logoUrl: this.logoUrl(g.logo),
      sports: g.sports.map((s) => ({ code: s.sport.code, name: s.sport.nameI18n, icon: s.sport.icon })).sort((a, b) => a.code.localeCompare(b.code)),
      membersCount: g._count.members,
      level: g.level,
    };
  }

  // ───────────── Creation & verification ─────────────

  /** The submitter becomes the gym's admin once an admin verifies it (spec §16.1 workflow). */
  async create(user: AuthUser, dto: CreateGymDto) {
    const city = await this.prisma.city.findUnique({ where: { id: dto.cityId } });
    if (!city || city.governorateId !== dto.governorateId) throw AppException.validation([{ field: 'cityId', code: 'NOT_IN_GOVERNORATE' }]);
    const links = this.cleanLinks(dto.socialLinks);
    await this.checkSports(dto.sportIds);
    if (await this.prisma.gymVerificationRequest.count({ where: { submittedById: user.id, status: 'PENDING' } })) {
      throw AppException.conflict(ErrorCode.CONFLICT, 'You already have a gym waiting for verification.');
    }
    const id = uuidv7();
    const slug = await this.uniqueSlug(dto.name);
    await this.prisma.$transaction(async (tx) => {
      await tx.gym.create({
        data: {
          id,
          name: dto.name.trim(),
          slug,
          governorateId: dto.governorateId,
          cityId: dto.cityId,
          addressLine: dto.addressLine,
          contactPhone: dto.contactPhone,
          contactEmail: dto.contactEmail,
          socialLinks: links,
          status: 'PENDING',
          ownerUserId: user.id,
        },
      });
      if (dto.sportIds?.length) await tx.gymSport.createMany({ data: dto.sportIds.map((sportId) => ({ gymId: id, sportId })) });
      await tx.gymVerificationRequest.create({ data: { id: uuidv7(), gymId: id, submittedById: user.id, proofText: dto.proofOfOwnership } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'GYM_SUBMITTED', entityType: 'gym', entityId: id }, tx);
    });
    return { id, slug, status: 'PENDING' };
  }

  async verificationQueue(q: PageQueryDto) {
    const c = q.cursor ? this.cursors.decode<{ id: string }>(q.cursor) : null;
    const rows = await this.prisma.gymVerificationRequest.findMany({
      where: { status: 'PENDING', ...(c && { id: { gt: c.id } }) },
      include: { gym: { include: { city: true, governorate: true, logo: true, sports: { include: { sport: true } } } } },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
    });
    const page = toPage(rows, q.limit, (r) => ({ id: r.id }), (k) => this.cursors.encode(k));
    return {
      data: page.data.map((r) => ({
        id: r.id,
        submittedById: r.submittedById,
        proofText: r.proofText,
        createdAt: r.createdAt.toISOString(),
        gym: {
          id: r.gym.id,
          name: r.gym.name,
          city: r.gym.city.nameI18n,
          governorate: r.gym.governorate.code,
          addressLine: r.gym.addressLine,
          contactPhone: r.gym.contactPhone,
          contactEmail: r.gym.contactEmail,
          socialLinks: r.gym.socialLinks,
          logoUrl: this.logoUrl(r.gym.logo),
          sports: r.gym.sports.map((s) => s.sport.code).sort(),
        },
      })),
      page: page.page,
    };
  }

  async review(admin: AuthUser, requestId: string, dto: ReviewGymDto) {
    const req = await this.prisma.gymVerificationRequest.findUnique({ where: { id: requestId }, include: { gym: true } });
    if (!req || req.status !== 'PENDING') throw AppException.notFound('Verification request');
    const approve = dto.decision === 'APPROVE';
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.gymVerificationRequest.update({ where: { id: requestId }, data: { status: approve ? 'APPROVED' : 'REJECTED', reviewedById: admin.id, reviewNote: dto.note, reviewedAt: now } });
      await tx.gym.update({ where: { id: req.gymId }, data: approve ? { status: 'VERIFIED', verifiedAt: now, verifiedById: admin.id } : { status: 'REJECTED' } });
      if (approve && req.gym.ownerUserId) {
        const owner = await tx.user.findUniqueOrThrow({ where: { id: req.gym.ownerUserId } });
        // Promote plain users only; never downgrade a moderator or admin who owns a gym.
        if (owner.role === 'USER') await tx.user.update({ where: { id: owner.id }, data: { role: 'GYM_ADMIN' } });
        // The owner is a member of their own gym.
        await tx.gymMember.updateMany({ where: { userId: owner.id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'LEFT', leftAt: now } });
        await tx.gymMember.create({ data: { id: uuidv7(), gymId: req.gymId, userId: owner.id, status: 'APPROVED', approvedAt: now, approvedById: admin.id } });
        await tx.profile.update({ where: { userId: owner.id }, data: { primaryGymId: req.gymId } });
      }
      await this.audit.log({ actorId: admin.id, actorRole: admin.role, action: approve ? 'GYM_VERIFIED' : 'GYM_REJECTED', entityType: 'gym', entityId: req.gymId, after: { note: dto.note ?? null } }, tx);
    });
    return { gymId: req.gymId, status: approve ? 'VERIFIED' : 'REJECTED' };
  }

  async update(user: AuthUser, id: string, dto: UpdateGymDto) {
    const gym = await this.manageable(user, id);
    await this.checkSports(dto.sportIds);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.gym.update({
        where: { id: gym.id },
        data: { name: dto.name?.trim(), addressLine: dto.addressLine, contactPhone: dto.contactPhone, contactEmail: dto.contactEmail, socialLinks: dto.socialLinks ? this.cleanLinks(dto.socialLinks) : undefined },
      });
      if (dto.sportIds) {
        await tx.gymSport.deleteMany({ where: { gymId: gym.id } });
        await tx.gymSport.createMany({ data: dto.sportIds.map((sportId) => ({ gymId: gym.id, sportId })) });
      }
      return row;
    });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'GYM_UPDATED', entityType: 'gym', entityId: id, before: { name: gym.name }, after: { name: updated.name, sportIds: dto.sportIds ?? null } });
    return this.get(id, user);
  }

  // ───────────── Memberships ─────────────

  async requestMembership(userId: string, gymId: string) {
    const gym = await this.prisma.gym.findUnique({ where: { id: gymId } });
    if (!gym || gym.status !== 'VERIFIED' || gym.deletedAt) throw AppException.notFound('Gym');
    const active = await this.prisma.gymMember.findFirst({ where: { userId, status: { in: ['PENDING', 'APPROVED'] } } });
    if (active) throw AppException.conflict(ErrorCode.CONFLICT, 'Leave your current gym first (one gym per athlete).', { gymId: active.gymId, membershipStatus: active.status });
    await this.prisma.gymMember.create({ data: { id: uuidv7(), gymId, userId, status: 'PENDING' } });
    return { gymId, status: 'PENDING' };
  }

  async leave(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.gymMember.updateMany({ where: { userId, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'LEFT', leftAt: this.clock.now() } }),
      this.prisma.profile.update({ where: { userId }, data: { primaryGymId: null } }),
    ]);
  }

  async myMembership(userId: string) {
    const m = await this.prisma.gymMember.findFirst({ where: { userId, status: { in: ['PENDING', 'APPROVED'] } }, include: { gym: true } });
    return m ? { gymId: m.gymId, gymName: m.gym.name, status: m.status } : null;
  }

  async members(gymId: string, q: PageQueryDto) {
    const c = q.cursor ? this.cursors.decode<{ id: string }>(q.cursor) : null;
    const rows = await this.prisma.gymMember.findMany({
      where: { gymId, status: 'APPROVED', user: { status: 'ACTIVE' }, ...(c && { id: { gt: c.id } }) },
      include: { user: { select: { id: true, username: true, profile: { select: { fullName: true } } } } },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
    });
    const page = toPage(rows, q.limit, (r) => ({ id: r.id }), (k) => this.cursors.encode(k));
    return { data: page.data.map((m) => ({ id: m.user.id, username: m.user.username, fullName: m.user.profile?.fullName, role: m.role, since: m.approvedAt?.toISOString() ?? null })), page: page.page };
  }

  async membershipRequests(user: AuthUser, gymId: string) {
    await this.manageable(user, gymId);
    const rows = await this.prisma.gymMember.findMany({
      where: { gymId, status: 'PENDING' },
      include: { user: { select: { id: true, username: true, profile: { select: { fullName: true } } } } },
      orderBy: { requestedAt: 'asc' },
    });
    return rows.map((m) => ({ userId: m.user.id, username: m.user.username, fullName: m.user.profile?.fullName, requestedAt: m.requestedAt.toISOString() }));
  }

  async decide(user: AuthUser, gymId: string, memberId: string, action: 'approve' | 'reject' | 'remove') {
    await this.manageable(user, gymId);
    const m = await this.prisma.gymMember.findFirst({ where: { gymId, userId: memberId, status: action === 'remove' ? 'APPROVED' : 'PENDING' } });
    if (!m) throw AppException.notFound('Membership');
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      if (action === 'approve') {
        await tx.gymMember.update({ where: { id: m.id }, data: { status: 'APPROVED', approvedAt: now, approvedById: user.id } });
        await tx.profile.update({ where: { userId: memberId }, data: { primaryGymId: gymId } });
      } else {
        await tx.gymMember.update({ where: { id: m.id }, data: { status: action === 'reject' ? 'REJECTED' : 'REMOVED', leftAt: now } });
        if (action === 'remove') await tx.profile.update({ where: { userId: memberId }, data: { primaryGymId: null } });
      }
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: `GYM_MEMBER_${action.toUpperCase()}`, entityType: 'gym_member', entityId: m.id, after: { gymId, userId: memberId } }, tx);
    });
    return { userId: memberId, status: action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : 'REMOVED' };
  }

  // ───────────── Coaches ─────────────

  async setCoach(user: AuthUser, gymId: string, memberId: string, coach: boolean) {
    await this.manageable(user, gymId);
    const m = await this.prisma.gymMember.findFirst({ where: { gymId, userId: memberId, status: 'APPROVED' } });
    if (!m) throw AppException.notFound('Membership');
    await this.prisma.$transaction(async (tx) => {
      await tx.gymMember.update({ where: { id: m.id }, data: { role: coach ? 'COACH' : 'MEMBER' } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: coach ? 'GYM_COACH_APPOINTED' : 'GYM_COACH_REMOVED', entityType: 'gym_member', entityId: m.id, after: { gymId, userId: memberId } }, tx);
    });
    return { userId: memberId, role: coach ? 'COACH' : 'MEMBER' };
  }

  approvedMember(userId: string, gymId: string) {
    return this.prisma.gymMember.findFirst({ where: { gymId, userId, status: 'APPROVED' } });
  }

  /** Coach of this gym: an approved member with the COACH role, the gym's admin, or platform staff. */
  async isCoach(user: AuthUser, gymId: string): Promise<boolean> {
    const gym = await this.prisma.gym.findUnique({ where: { id: gymId } });
    if (!gym || gym.deletedAt) return false;
    if (this.canManage(user, gym)) return true;
    return (await this.approvedMember(user.id, gymId))?.role === 'COACH';
  }

  // ───────────── Internals ─────────────

  logoUrl(logo: Media | null): string | null {
    return logo && logo.status !== 'DELETED' ? this.storage.url(logo.objectKey) : null;
  }

  /** Gym admin of THIS gym (the verified owner), or platform staff. */
  async manageable(user: AuthUser, gymId: string): Promise<Gym> {
    const gym = await this.prisma.gym.findUnique({ where: { id: gymId } });
    if (!gym || gym.deletedAt) throw AppException.notFound('Gym');
    if (!this.canManage(user, gym)) throw AppException.forbidden('Only this gym\'s admin can do that.');
    return gym;
  }

  /** Logo edits: the gym's admin or staff, and also the submitter while the gym awaits verification. */
  async logoEditable(user: AuthUser, gymId: string): Promise<Gym> {
    const gym = await this.prisma.gym.findUnique({ where: { id: gymId } });
    if (!gym || gym.deletedAt) throw AppException.notFound('Gym');
    const pendingSubmitter = gym.ownerUserId === user.id && gym.status === 'PENDING';
    if (!pendingSubmitter && !this.canManage(user, gym)) throw AppException.forbidden('Only this gym\'s admin can do that.');
    return gym;
  }

  /** Gyms I submitted or own, whatever their verification status (to follow a request). */
  async mine(userId: string) {
    const rows = await this.prisma.gym.findMany({ where: { ownerUserId: userId, deletedAt: null }, include: { logo: true }, orderBy: { createdAt: 'desc' } });
    return rows.map((g) => ({ id: g.id, name: g.name, slug: g.slug, status: g.status, logoUrl: this.logoUrl(g.logo) }));
  }

  canManage(user: AuthUser, gym: Gym): boolean {
    const owner = gym.ownerUserId === user.id && user.role === 'GYM_ADMIN' && gym.status === 'VERIFIED';
    return owner || STAFF.includes(user.role);
  }

  private async checkSports(sportIds?: string[]): Promise<void> {
    if (!sportIds?.length) return;
    const found = await this.prisma.sport.count({ where: { id: { in: sportIds }, enabled: true } });
    if (found !== sportIds.length) throw AppException.validation([{ field: 'sportIds', code: 'UNKNOWN_SPORT' }]);
  }

  private cleanLinks(links?: Record<string, string>): Prisma.InputJsonObject {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(links ?? {})) {
      if (!(SOCIAL_LINK_KEYS as readonly string[]).includes(k) || typeof v !== 'string' || !isHttpUrl(v) || v.length > 300) {
        throw AppException.validation([{ field: `socialLinks.${k}`, code: 'INVALID_LINK' }]);
      }
      out[k] = v;
    }
    return out;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 50) || 'gym';
    for (let i = 0; ; i++) {
      const slug = i === 0 ? base : `${base}-${i + 1}`;
      if (!(await this.prisma.gym.findUnique({ where: { slug } }))) return slug;
    }
  }
}
