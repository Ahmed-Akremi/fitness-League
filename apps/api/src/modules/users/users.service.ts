import { Injectable } from '@nestjs/common';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ageBracket, ageInYears } from '../auth/auth-policy';
import { levelTitleKey } from '../scoring/level';
import { RuleSetService } from '../scoring/rule-set.service';
import { UpdateProfileDto, UpdateSettingsDto } from './dto/users.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleSets: RuleSetService,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
  ) {}

  /** Everything the home screen needs about the signed-in user, in one call. */
  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        profile: { include: { governorate: true, city: true, primaryGym: { select: { id: true, name: true, slug: true } } } },
        settings: true,
        stats: { include: { division: true } },
        streak: true,
        sports: { include: { sport: { select: { id: true, code: true } } } },
      },
    });
    const { config } = await this.ruleSets.getActive();
    const { profile, settings, stats, streak } = user;
    const age = ageInYears(user.dateOfBirth.toISOString().slice(0, 10), this.calendar.localDate(this.clock.now()));

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      role: user.role,
      // The owner sees their bracket; the date of birth itself is never returned by the API.
      ageBracket: ageBracket(age),
      profile: profile && {
        fullName: profile.fullName,
        bio: profile.bio,
        gender: profile.gender,
        countryCode: profile.countryCode,
        governorate: { id: profile.governorate.id, code: profile.governorate.code, name: profile.governorate.nameI18n },
        city: { id: profile.city.id, name: profile.city.nameI18n },
        gym: profile.primaryGym,
        experienceLevelDeclared: profile.experienceLevelDeclared,
        plannedTrainingDaysPerWeek: profile.plannedTrainingDaysPerWeek,
        calibrationEndsAt: profile.calibrationEndsAt?.toISOString() ?? null,
        onboardingCompleted: profile.onboardingCompletedAt !== null,
        sports: user.sports.map((s) => ({ id: s.sport.id, code: s.sport.code, isPrimary: s.isPrimary })),
      },
      settings: settings && {
        locale: settings.locale,
        theme: settings.theme,
        reducedMotion: settings.reducedMotion,
        defaultVisibility: settings.defaultVisibility,
        showAgeBracket: settings.showAgeBracket,
        showOnLeaderboards: settings.showOnLeaderboards,
        streakFreezeDaysPerWeek: settings.streakFreezeDaysPerWeek,
      },
      stats: stats && {
        xpTotal: Number(stats.xpTotal),
        level: stats.level,
        levelTitleKey: levelTitleKey(stats.level, config),
        xpIntoLevel: stats.xpIntoLevel,
        xpForNextLevel: stats.xpForNextLevel,
        seasonLp: stats.seasonLp,
        division: stats.division?.code ?? null,
        leaderboardEligible: stats.leaderboardEligible,
      },
      streak: streak && { currentWeeks: streak.currentWeeks, longestWeeks: streak.longestWeeks, currentDays: streak.currentDays },
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if ((dto.governorateId === undefined) !== (dto.cityId === undefined)) {
      throw AppException.validation([{ field: dto.cityId ? 'governorateId' : 'cityId', code: 'REQUIRED_TOGETHER' }]);
    }
    if (dto.cityId) {
      const city = await this.prisma.city.findUnique({ where: { id: dto.cityId } });
      if (!city || city.governorateId !== dto.governorateId) throw AppException.validation([{ field: 'cityId', code: 'NOT_IN_GOVERNORATE' }]);
    }
    await this.prisma.profile.update({
      where: { userId },
      data: {
        fullName: dto.fullName?.trim(),
        bio: dto.bio,
        gender: dto.gender,
        governorateId: dto.governorateId,
        cityId: dto.cityId,
        experienceLevelDeclared: dto.experienceLevelDeclared,
        plannedTrainingDaysPerWeek: dto.plannedTrainingDaysPerWeek,
      },
    });
    return this.me(userId);
  }

  async updateSettings(userId: string, dto: UpdateSettingsDto) {
    await this.prisma.userSettings.update({ where: { userId }, data: dto });
    return this.me(userId);
  }
}
