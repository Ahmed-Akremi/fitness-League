import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GymsService } from './gyms.service';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const TREND_WEEKS = 8;
const INACTIVE_DAYS = 14;

/**
 * Gym admin dashboard (docs §4.5 P3 `/gyms/{id}/dashboard`): how many members train, the weekly trend, who is
 * progressing, who needs a nudge, WOD participation and the Gym War record. Aggregates only members who chose this
 * gym as their primary gym; health data never appears here.
 */
@Injectable()
export class GymDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gyms: GymsService,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
  ) {}

  async dashboard(user: AuthUser, gymId: string) {
    const gym = await this.prisma.gym.findFirst({ where: { id: gymId, deletedAt: null } });
    if (!gym) throw AppException.notFound('Gym');
    if (!this.gyms.canManage(user, gym)) throw AppException.forbidden("Only this gym's admin can see its dashboard.");
    const now = this.clock.now();
    const thisWeek = this.calendar.weekStart(now);
    const col = (d: Date) => new Date(`${this.calendar.localDate(d)}T00:00:00Z`);

    const [approved, pending] = await Promise.all([
      this.prisma.gymMember.findMany({ where: { gymId, status: 'APPROVED' }, select: { userId: true, user: { select: { username: true, profile: { select: { fullName: true } } } } } }),
      this.prisma.gymMember.count({ where: { gymId, status: 'PENDING' } }),
    ]);
    const ids = approved.map((m) => m.userId);
    const name = new Map(approved.map((m) => [m.userId, m.user.profile?.fullName ?? m.user.username]));

    const [lastWorkouts, weekly, wods, outcomes] = await Promise.all([
      this.prisma.workout.groupBy({ by: ['userId'], where: { userId: { in: ids }, status: 'ACCEPTED', deletedAt: null }, _max: { performedAt: true } }),
      this.prisma.weeklyScore.findMany({
        where: { userId: { in: ids }, weekStart: { gte: col(new Date(thisWeek.getTime() - TREND_WEEKS * WEEK)), lt: col(thisWeek) } },
        select: { userId: true, weekStart: true, total: true, progressC: true },
      }),
      this.prisma.gymWod.findMany({ where: { gymId }, orderBy: { startsAt: 'desc' }, take: 4, select: { id: true, title: true, _count: { select: { scores: { where: { status: 'VALID' } } } } } }),
      this.prisma.gymWarParticipant.groupBy({ by: ['outcome'], where: { gymId, outcome: { not: null } }, _count: true }),
    ]);
    const last = new Map(lastWorkouts.map((w) => [w.userId, w._max.performedAt]));
    const activeSince = (days: number) => ids.filter((id) => (last.get(id)?.getTime() ?? 0) >= now.getTime() - days * DAY).length;

    // Weekly trend over closed weeks: members with a score, and their mean total.
    const trend = Array.from({ length: TREND_WEEKS }, (_, i) => {
      const start = new Date(thisWeek.getTime() - (TREND_WEEKS - i) * WEEK);
      const rows = weekly.filter((w) => w.weekStart.getTime() === col(start).getTime());
      return { weekStart: this.calendar.localDate(start), activeMembers: rows.length, meanScore: rows.length ? Math.round((rows.reduce((a, r) => a + Number(r.total), 0) / rows.length) * 10) / 10 : null };
    });
    const lastWeek = col(new Date(thisWeek.getTime() - WEEK)).getTime();
    const topProgress = weekly
      .filter((w) => w.weekStart.getTime() === lastWeek)
      .sort((a, b) => Number(b.progressC) - Number(a.progressC))
      .slice(0, 5)
      .map((w) => ({ userId: w.userId, name: name.get(w.userId) ?? null, progress: Number(w.progressC), total: Number(w.total) }));
    const toNudge = ids
      .filter((id) => (last.get(id)?.getTime() ?? 0) < now.getTime() - INACTIVE_DAYS * DAY)
      .map((id) => ({ userId: id, name: name.get(id) ?? null, lastWorkoutAt: last.get(id)?.toISOString() ?? null }))
      .slice(0, 20);
    const count = (o: string) => outcomes.find((x) => x.outcome === o)?._count ?? 0;

    return {
      gym: { id: gym.id, name: gym.name, rating: Math.round(Number(gym.rating)) },
      members: { approved: ids.length, pending, activeLast7Days: activeSince(7), activeLast28Days: activeSince(28) },
      trend,
      topProgress,
      toNudge,
      wods: wods.map((w) => ({ id: w.id, title: w.title, scores: w._count.scores })),
      wars: { wins: count('WIN'), losses: count('LOSS'), draws: count('DRAW'), enrolled: !gym.warsOptOut },
    };
  }
}
