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
    const c = q.cursor ? this.cursors.decode<{ n: string; id: string }>(q.cursor) : null;
    const where: Prisma.GymWhereInput = {
      status: 'VERIFIED',
      deletedAt: null,
      governorateId: q.governorateId,
      ...(q.q && { name: { contains: q.q, mode: 'insensitive' } }),
      ...(c && { OR: [{ name: { gt: c.n } }, { name: c.n, id: { gt: c.id } }] }),
    };
    const rows = await this.prisma.gym.findMany({ where, include: { city: true, governorate: true, logo: true, _count: { select: { members: { where: { status: 'APPROVED' } } } } }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: q.limit + 1 });
    const page = toPage(rows, q.limit, (g) => ({ n: g.name, id: g.id }), (k) => this.cursors.encode(k));
    return { data: page.data.map((g) => this.card(g)), page: page.page };
  }

  /** Public gym profile: city-level location only, members count, top athletes of the season. */
  async get(id: string) {
    const gym = await this.prisma.gym.findUnique({
      where: { id },
      include: { city: true, governorate: true, logo: true, _count: { select: { members: { where: { status: 'APPROVED' } } } } },
    });
    if (!gym || gym.deletedAt || gym.status !== 'VERIFIED') throw AppException.notFound('Gym');
    const top = await this.prisma.userStats.findMany({
      where: { user: { status: 'ACTIVE', profile: { primaryGymId: id } }, season: { status: 'ACTIVE' } },
      orderBy: [{ seasonLp: 'desc' }, { userId: 'asc' }],
      take: 5,
      include: { user: { select: { username: true, profile: { select: { fullName: true } } } } },
    });
    return {
      ...this.card(gym),
      level: gym.level,
      socialLinks: gym.socialLinks,
      topAthletes: top.map((s) => ({ id: s.userId, username: s.user.username, fullName: s.user.profile?.fullName, lp: s.seasonLp, level: s.level })),
      warRecord: null, // Gym Wars: Phase 2
    };
  }

  private card(g: Gym & { city: { nameI18n: Prisma.JsonValue }; governorate: { id: string; code: string; nameI18n: Prisma.JsonValue }; logo: Media | null; _count: { members: number } }) {
    return {
      id: g.id,
      name: g.name,
      slug: g.slug,
      verified: g.status === 'VERIFIED',
      city: g.city.nameI18n,
      governorate: { id: g.governorate.id, code: g.governorate.code, name: g.governorate.nameI18n },
      logoUrl: this.logoUrl(g.logo),
      membersCount: g._count.members,
    };
  }

  // ───────────── Creation & verification ─────────────

  /** The submitter becomes the gym's admin once an admin verifies it (spec §16.1 workflow). */
  async create(user: AuthUser, dto: CreateGymDto) {
    const city = await this.prisma.city.findUnique({ where: { id: dto.cityId } });
    if (!city || city.governorateId !== dto.governorateId) throw AppException.validation([{ field: 'cityId', code: 'NOT_IN_GOVERNORATE' }]);
    const links = this.cleanLinks(dto.socialLinks);
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
      await tx.gymVerificationRequest.create({ data: { id: uuidv7(), gymId: id, submittedById: user.id, proofText: dto.proofOfOwnership } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'GYM_SUBMITTED', entityType: 'gym', entityId: id }, tx);
    });
    return { id, slug, status: 'PENDING' };
  }

  async verificationQueue(q: PageQueryDto) {
    const c = q.cursor ? this.cursors.decode<{ id: string }>(q.cursor) : null;
    const rows = await this.prisma.gymVerificationRequest.findMany({
      where: { status: 'PENDING', ...(c && { id: { gt: c.id } }) },
      include: { gym: { include: { city: true, governorate: true } } },
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
        gym: { id: r.gym.id, name: r.gym.name, city: r.gym.city.nameI18n, governorate: r.gym.governorate.code, addressLine: r.gym.addressLine, contactPhone: r.gym.contactPhone, contactEmail: r.gym.contactEmail, socialLinks: r.gym.socialLinks },
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
    const updated = await this.prisma.gym.update({
      where: { id: gym.id },
      data: { name: dto.name?.trim(), addressLine: dto.addressLine, contactPhone: dto.contactPhone, contactEmail: dto.contactEmail, socialLinks: dto.socialLinks ? this.cleanLinks(dto.socialLinks) : undefined },
    });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'GYM_UPDATED', entityType: 'gym', entityId: id, before: { name: gym.name }, after: { name: updated.name } });
    return this.get(id);
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
    return { data: page.data.map((m) => ({ id: m.user.id, username: m.user.username, fullName: m.user.profile?.fullName, since: m.approvedAt?.toISOString() ?? null })), page: page.page };
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

  // ───────────── Internals ─────────────

  logoUrl(logo: Media | null): string | null {
    return logo && logo.status !== 'DELETED' ? this.storage.url(logo.objectKey) : null;
  }

  /** Gym admin of THIS gym (the verified owner), or platform staff. */
  async manageable(user: AuthUser, gymId: string): Promise<Gym> {
    const gym = await this.prisma.gym.findUnique({ where: { id: gymId } });
    if (!gym || gym.deletedAt) throw AppException.notFound('Gym');
    const owner = gym.ownerUserId === user.id && user.role === 'GYM_ADMIN' && gym.status === 'VERIFIED';
    if (!owner && !STAFF.includes(user.role)) throw AppException.forbidden('Only this gym\'s admin can do that.');
    return gym;
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
