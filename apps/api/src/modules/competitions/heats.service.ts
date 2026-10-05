import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AutoHeatsDto, HeatDto, LaneDto } from './competitions.dto';
import { seedHeats } from './domain';
import { JudgingService } from './judging.service';

/** On-site heats (§45): schedule, lanes and athlete assignment. Organizers write, everyone reads. */
@Injectable()
export class HeatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly judging: JudgingService,
  ) {}

  /** Running order with the athletes in each lane; `mine` marks the viewer's own lanes. */
  async list(user: AuthUser, competitionId: string) {
    const heats = await this.prisma.competitionHeat.findMany({
      where: { competitionId },
      orderBy: [{ startsAt: { sort: 'asc', nulls: 'last' } }, { number: 'asc' }],
      include: { lanes: { orderBy: { lane: 'asc' }, include: { registration: { select: { userId: true } } } }, workout: { select: { id: true, name: true, number: true } }, category: { select: { id: true, name: true } } },
    });
    const names = await this.judging.names(heats.flatMap((h) => h.lanes.map((l) => l.registration.userId)));
    return heats.map((h) => ({
      id: h.id,
      number: h.number,
      name: h.name,
      startsAt: h.startsAt?.toISOString() ?? null,
      durationMin: h.durationMin,
      laneCount: h.laneCount,
      workout: h.workout,
      category: h.category,
      lanes: h.lanes.map((l) => ({
        lane: l.lane,
        registrationId: l.registrationId,
        athlete: { id: l.registration.userId, ...(names.get(l.registration.userId) ?? { fullName: null, username: null }) },
        mine: l.registration.userId === user.id,
      })),
    }));
  }

  async create(user: AuthUser, competitionId: string, dto: HeatDto) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    await this.checkRefs(competitionId, dto);
    const last = await this.prisma.competitionHeat.findFirst({ where: { competitionId, workoutId: dto.workoutId ?? null }, orderBy: { number: 'desc' }, select: { number: true } });
    const number = (last?.number ?? 0) + 1;
    const heat = await this.prisma.competitionHeat.create({
      data: { id: uuidv7(), competitionId, number, name: dto.name ?? `Heat ${number}`, workoutId: dto.workoutId ?? null, categoryId: dto.categoryId ?? null, startsAt: dto.startsAt ? new Date(dto.startsAt) : null, durationMin: dto.durationMin ?? null, laneCount: dto.laneCount ?? 8 },
    });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.heat.created', entityType: 'CompetitionHeat', entityId: heat.id, after: { ...dto, number } });
    return heat;
  }

  async update(user: AuthUser, competitionId: string, heatId: string, dto: HeatDto) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    const before = await this.heat(competitionId, heatId);
    await this.checkRefs(competitionId, dto);
    if (dto.laneCount != null && (await this.prisma.competitionHeatLane.count({ where: { heatId, lane: { gt: dto.laneCount } } })) > 0) {
      throw AppException.validation([{ field: 'laneCount', code: 'LANES_IN_USE' }]);
    }
    const heat = await this.prisma.competitionHeat.update({
      where: { id: heatId },
      data: { name: dto.name, workoutId: dto.workoutId, categoryId: dto.categoryId, startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined, durationMin: dto.durationMin, laneCount: dto.laneCount },
    });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.heat.updated', entityType: 'CompetitionHeat', entityId: heatId, before: { name: before.name, startsAt: before.startsAt, laneCount: before.laneCount }, after: { ...dto } });
    return heat;
  }

  async remove(user: AuthUser, competitionId: string, heatId: string) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    await this.heat(competitionId, heatId);
    await this.prisma.competitionHeat.delete({ where: { id: heatId } });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.heat.deleted', entityType: 'CompetitionHeat', entityId: heatId });
  }

  /** One confirmed athlete per lane, once per heat, from the heat's category when it has one. */
  async assign(user: AuthUser, competitionId: string, heatId: string, dto: LaneDto) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    const heat = await this.heat(competitionId, heatId);
    if (dto.lane > heat.laneCount) throw AppException.validation([{ field: 'lane', code: 'LANE_OUT_OF_RANGE' }]);
    const reg = await this.prisma.competitionRegistration.findFirst({ where: { id: dto.registrationId, competitionId, registrationStatus: 'CONFIRMED' } });
    if (!reg) throw AppException.validation([{ field: 'registrationId', code: 'NOT_A_CONFIRMED_ATHLETE' }]);
    if (heat.categoryId && reg.categoryId !== heat.categoryId) throw AppException.validation([{ field: 'registrationId', code: 'WRONG_CATEGORY' }]);
    const taken = await this.prisma.competitionHeatLane.findFirst({ where: { heatId, OR: [{ lane: dto.lane }, { registrationId: dto.registrationId }] } });
    if (taken) throw AppException.conflict(ErrorCode.CONFLICT, taken.lane === dto.lane ? 'Lane already taken' : 'Athlete already in this heat', { reason: taken.lane === dto.lane ? 'LANE_TAKEN' : 'ALREADY_IN_HEAT' });
    const lane = await this.prisma.competitionHeatLane.create({ data: { id: uuidv7(), heatId, lane: dto.lane, registrationId: dto.registrationId } });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.heat.lane_assigned', entityType: 'CompetitionHeat', entityId: heatId, after: { ...dto } });
    return lane;
  }

  async unassign(user: AuthUser, competitionId: string, heatId: string, lane: number) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    await this.heat(competitionId, heatId);
    const { count } = await this.prisma.competitionHeatLane.deleteMany({ where: { heatId, lane } });
    if (count === 0) throw AppException.notFound('Lane');
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.heat.lane_freed', entityType: 'CompetitionHeat', entityId: heatId, after: { lane } });
  }

  /**
   * Fills a category's confirmed athletes into new heats: current leaderboard order (registration order
   * for the unranked), leaders in the last heat. Refused when that category already has heats for the WOD.
   */
  async auto(user: AuthUser, competitionId: string, dto: AutoHeatsDto) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    await this.checkRefs(competitionId, dto);
    const workoutId = dto.workoutId ?? null;
    if (await this.prisma.competitionHeat.count({ where: { competitionId, workoutId, categoryId: dto.categoryId } })) {
      throw AppException.conflict(ErrorCode.CONFLICT, 'This category already has heats for this WOD', { reason: 'HEATS_EXIST' });
    }
    const regs = await this.prisma.competitionRegistration.findMany({ where: { competitionId, categoryId: dto.categoryId, registrationStatus: 'CONFIRMED' }, orderBy: { registeredAt: 'asc' }, select: { id: true, userId: true } });
    const ranks = new Map(
      (await this.prisma.competitionLeaderboardEntry.findMany({ where: { competitionId, categoryId: dto.categoryId }, select: { userId: true, rank: true } })).map((e) => [e.userId, e.rank]),
    );
    const bestFirst = regs
      .map((r, i) => ({ ...r, order: i }))
      .sort((a, b) => (ranks.get(a.userId) ?? Infinity) - (ranks.get(b.userId) ?? Infinity) || a.order - b.order);
    const groups = seedHeats(bestFirst, dto.laneCount);
    const category = await this.prisma.competitionCategory.findUniqueOrThrow({ where: { id: dto.categoryId }, select: { name: true } });

    const created = await this.prisma.$transaction(async (tx) => {
      const last = await tx.competitionHeat.findFirst({ where: { competitionId, workoutId }, orderBy: { number: 'desc' }, select: { number: true } });
      const start = dto.startsAt ? new Date(dto.startsAt).getTime() : null;
      const out: string[] = [];
      for (const [i, group] of groups.entries()) {
        const number = (last?.number ?? 0) + i + 1;
        const id = uuidv7();
        await tx.competitionHeat.create({
          data: { id, competitionId, workoutId, categoryId: dto.categoryId, number, name: `${category.name} · Heat ${i + 1}`, laneCount: dto.laneCount, startsAt: start == null ? null : new Date(start + i * (dto.intervalMin ?? 0) * 60_000), durationMin: dto.intervalMin ?? null },
        });
        await tx.competitionHeatLane.createMany({ data: group.map((r, lane) => ({ id: uuidv7(), heatId: id, lane: lane + 1, registrationId: r.id })) });
        out.push(id);
      }
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.heat.auto_seeded', entityType: 'Competition', entityId: competitionId, after: { ...dto, heats: out.length, athletes: regs.length } }, tx);
      return out;
    });
    return { heats: created.length, athletes: regs.length };
  }

  private async heat(competitionId: string, heatId: string) {
    const heat = await this.prisma.competitionHeat.findFirst({ where: { id: heatId, competitionId } });
    if (!heat) throw AppException.notFound('Heat');
    return heat;
  }

  private async checkRefs(competitionId: string, dto: { workoutId?: string; categoryId?: string }) {
    if (dto.workoutId && !(await this.prisma.competitionWorkout.findFirst({ where: { id: dto.workoutId, competitionId } }))) throw AppException.validation([{ field: 'workoutId', code: 'NOT_IN_COMPETITION' }]);
    if (dto.categoryId && !(await this.prisma.competitionCategory.findFirst({ where: { id: dto.categoryId, competitionId } }))) throw AppException.validation([{ field: 'categoryId', code: 'NOT_IN_COMPETITION' }]);
  }
}
