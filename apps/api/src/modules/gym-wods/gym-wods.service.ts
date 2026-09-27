import { Injectable } from '@nestjs/common';
import { GymWod, GymWodScore, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { CursorCodec } from '../../common/pagination/cursor';
import { toPage } from '../../common/pagination/page';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GymsService } from '../gyms/gyms.service';
import { CreateGymWodDto, ListGymWodsQueryDto, UpdateGymWodDto } from './dto/gym-wod.dto';
import { validateWindow } from './wod-ranking';

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
