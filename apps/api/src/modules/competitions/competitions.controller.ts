import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { AdminApi, CurrentUser, RequiresVerifiedEmail, Roles } from '../../common/auth/decorators';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import {
  AdjustScoreDto,
  AnnouncementDto,
  AppealDecisionDto,
  AssignmentDto,
  CategoryDto,
  CompetitionDto,
  CouponCheckDto,
  CouponDto,
  JudgeQueueQueryDto,
  LeaderboardQueryDto,
  ListCompetitionsQueryDto,
  PenaltyDto,
  PrizeDto,
  ReasonDto,
  RegisterDto,
  ReorderDto,
  StaffDto,
  StatusDto,
  SubmissionDto,
  UpdateCategoryDto,
  UpdateCompetitionDto,
  WorkoutDto,
} from './competitions.dto';
import { CompetitionsService } from './competitions.service';
import { VIDEO_MAX_BYTES } from './domain';
import { JudgingService } from './judging.service';

const id = (name = 'id') => Param(name, ParseUUIDPipe);

/** Competitions: discovery, registration, WODs, submissions, leaderboard and organizer management. */
@ApiTags('competitions')
@ApiBearerAuth()
@Controller('competitions')
export class CompetitionsController {
  constructor(
    private readonly competitions: CompetitionsService,
    private readonly judging: JudgingService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListCompetitionsQueryDto) {
    return this.competitions.list(user, q);
  }

  @Post()
  @RequiresVerifiedEmail()
  create(@CurrentUser() user: AuthUser, @Body() dto: CompetitionDto) {
    return this.competitions.create(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @id() competitionId: string) {
    return this.competitions.get(user, competitionId);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @id() competitionId: string, @Body() dto: UpdateCompetitionDto) {
    return this.competitions.update(user, competitionId, dto);
  }

  @Patch(':id/status')
  status(@CurrentUser() user: AuthUser, @id() competitionId: string, @Body() dto: StatusDto) {
    return this.competitions.setStatus(user, competitionId, dto.status);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @id() competitionId: string): Promise<void> {
    return this.competitions.remove(user, competitionId);
  }

  @Get(':id/dashboard')
  dashboard(@CurrentUser() user: AuthUser, @id() competitionId: string) {
    return this.competitions.dashboard(user, competitionId);
  }

  // Categories
  @Get(':id/categories')
  async categories(@CurrentUser() user: AuthUser, @id() competitionId: string) {
    return (await this.competitions.get(user, competitionId)).categories;
  }

  @Post(':id/categories')
  addCategory(@CurrentUser() user: AuthUser, @id() competitionId: string, @Body() dto: CategoryDto) {
    return this.competitions.addCategory(user, competitionId, dto);
  }

  @Post(':id/categories/templates')
  templates(@CurrentUser() user: AuthUser, @id() competitionId: string) {
    return this.competitions.addTemplateCategories(user, competitionId);
  }

  @Put(':id/categories/:categoryId')
  updateCategory(@CurrentUser() user: AuthUser, @id() competitionId: string, @id('categoryId') categoryId: string, @Body() dto: UpdateCategoryDto) {
    return this.competitions.updateCategory(user, competitionId, categoryId, dto);
  }

  @Delete(':id/categories/:categoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCategory(@CurrentUser() user: AuthUser, @id() competitionId: string, @id('categoryId') categoryId: string): Promise<void> {
    return this.competitions.removeCategory(user, competitionId, categoryId);
  }

  // WODs
  @Get(':id/wods')
  async wods(@CurrentUser() user: AuthUser, @id() competitionId: string) {
    return (await this.competitions.get(user, competitionId)).workouts;
  }

  @Post(':id/wods')
  addWod(@CurrentUser() user: AuthUser, @id() competitionId: string, @Body() dto: WorkoutDto) {
    return this.competitions.addWorkout(user, competitionId, dto);
  }

  @Put(':id/wods/:wodId')
  updateWod(@CurrentUser() user: AuthUser, @id() competitionId: string, @id('wodId') wodId: string, @Body() dto: WorkoutDto) {
    return this.competitions.updateWorkout(user, competitionId, wodId, dto);
  }

  @Delete(':id/wods/:wodId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeWod(@CurrentUser() user: AuthUser, @id() competitionId: string, @id('wodId') wodId: string): Promise<void> {
    return this.competitions.removeWorkout(user, competitionId, wodId);
  }

  @Post(':id/wods/reorder')
  reorder(@CurrentUser() user: AuthUser, @id() competitionId: string, @Body() dto: ReorderDto) {
    return this.competitions.reorderWorkouts(user, competitionId, dto);
  }

  // Athlete
  @Post(':id/coupon/validate')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'competition-coupon', limit: 30, windowS: 3600, by: 'user' })
  validateCoupon(@CurrentUser() user: AuthUser, @id() competitionId: string, @Body() dto: CouponCheckDto) {
    return this.competitions.checkCouponCode(user, competitionId, dto);
  }

  @Post(':id/register')
  @RequiresVerifiedEmail()
  @RateLimit({ name: 'competition-register', limit: 10, windowS: 3600, by: 'user' })
  register(@CurrentUser() user: AuthUser, @id() competitionId: string, @Body() dto: RegisterDto) {
    return this.competitions.register(user, competitionId, dto);
  }

  @Post(':id/wods/:wodId/submissions')
  @RateLimit({ name: 'competition-submit', limit: 60, windowS: 3600, by: 'user' })
  submit(@CurrentUser() user: AuthUser, @id() competitionId: string, @id('wodId') wodId: string, @Body() dto: SubmissionDto) {
    return this.competitions.submit(user, competitionId, wodId, dto);
  }

  @Post(':id/videos')
  @RateLimit({ name: 'competition-video', limit: 20, windowS: 3600, by: 'user' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: VIDEO_MAX_BYTES + 1, files: 1 } }))
  uploadVideo(@CurrentUser() user: AuthUser, @id() competitionId: string, @UploadedFile() file?: Express.Multer.File) {
    return this.competitions.uploadVideo(user, competitionId, file);
  }

  @Get(':id/my-submissions')
  mySubmissions(@CurrentUser() user: AuthUser, @id() competitionId: string) {
    return this.competitions.mySubmissions(user, competitionId);
  }

  @Post(':id/submissions/:submissionId/appeals')
  appeal(@CurrentUser() user: AuthUser, @id('submissionId') submissionId: string, @Body() dto: ReasonDto) {
    return this.judging.appeal(user, submissionId, dto);
  }

  // Leaderboard
  @Get(':id/leaderboard')
  async leaderboard(@CurrentUser() user: AuthUser, @id() competitionId: string, @Query() q: LeaderboardQueryDto) {
    const categoryId = q.categoryId ?? (await this.competitions.get(user, competitionId)).categories[0]?.id;
    if (!categoryId) return { rows: [], workouts: [], provisional: true, podium: null, prizes: [] };
    return this.judging.leaderboard(competitionId, categoryId, q.workoutId);
  }

  @Post(':id/publish-leaderboard')
  @HttpCode(HttpStatus.OK)
  publish(@CurrentUser() user: AuthUser, @id() competitionId: string) {
    return this.judging.publish(user, competitionId);
  }

  // Organizer
  @Get(':id/registrations')
  registrations(@CurrentUser() user: AuthUser, @id() competitionId: string) {
    return this.competitions.registrations(user, competitionId);
  }

  @Post(':id/registrations/:registrationId/mark-paid')
  @HttpCode(HttpStatus.OK)
  markPaid(@CurrentUser() user: AuthUser, @id() competitionId: string, @id('registrationId') registrationId: string) {
    return this.competitions.markPaid(user, competitionId, registrationId);
  }

  @Get(':id/staff')
  staff(@CurrentUser() user: AuthUser, @id() competitionId: string) {
    return this.competitions.listStaff(user, competitionId);
  }

  @Post(':id/staff')
  addStaff(@CurrentUser() user: AuthUser, @id() competitionId: string, @Body() dto: StaffDto) {
    return this.competitions.addStaff(user, competitionId, dto);
  }

  @Delete(':id/staff/:staffId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeStaff(@CurrentUser() user: AuthUser, @id() competitionId: string, @id('staffId') staffId: string): Promise<void> {
    return this.competitions.removeStaff(user, competitionId, staffId);
  }

  @Post(':id/judge-assignments')
  assign(@CurrentUser() user: AuthUser, @id() competitionId: string, @Body() dto: AssignmentDto) {
    return this.competitions.assign(user, competitionId, dto);
  }

  @Post(':id/prizes')
  addPrize(@CurrentUser() user: AuthUser, @id() competitionId: string, @Body() dto: PrizeDto) {
    return this.competitions.addPrize(user, competitionId, dto);
  }

  @Delete(':id/prizes/:prizeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePrize(@CurrentUser() user: AuthUser, @id() competitionId: string, @id('prizeId') prizeId: string): Promise<void> {
    return this.competitions.removePrize(user, competitionId, prizeId);
  }

  @Get(':id/coupons')
  coupons(@CurrentUser() user: AuthUser, @id() competitionId: string) {
    return this.competitions.listCoupons(user, competitionId);
  }

  @Post(':id/coupons')
  addCoupon(@CurrentUser() user: AuthUser, @id() competitionId: string, @Body() dto: CouponDto) {
    return this.competitions.addCoupon(user, competitionId, dto);
  }

  @Post(':id/coupons/:couponId/:action')
  @HttpCode(HttpStatus.OK)
  toggleCoupon(@CurrentUser() user: AuthUser, @id() competitionId: string, @id('couponId') couponId: string, @Param('action') action: string) {
    return this.competitions.setCouponActive(user, competitionId, couponId, action === 'activate');
  }

  @Get(':id/announcements')
  announcements(@id() competitionId: string) {
    return this.competitions.announcements(competitionId);
  }

  @Post(':id/announcements')
  announce(@CurrentUser() user: AuthUser, @id() competitionId: string, @Body() dto: AnnouncementDto) {
    return this.competitions.announce(user, competitionId, dto);
  }

  @Get(':id/appeals')
  appeals(@CurrentUser() user: AuthUser, @id() competitionId: string) {
    return this.judging.appeals(user, competitionId);
  }
}

/** Judge space: review queue, decisions, appeals (§26-§30, §44). */
@ApiTags('judge')
@ApiBearerAuth()
@Controller('judge')
export class JudgeController {
  constructor(private readonly judging: JudgingService) {}

  @Get('submissions')
  queue(@CurrentUser() user: AuthUser, @Query() q: JudgeQueueQueryDto) {
    return this.judging.queue(user, q);
  }

  @Get('submissions/:id')
  detail(@CurrentUser() user: AuthUser, @id() submissionId: string) {
    return this.judging.detail(user, submissionId);
  }

  @Post('submissions/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() user: AuthUser, @id() submissionId: string) {
    return this.judging.approve(user, submissionId);
  }

  @Post('submissions/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentUser() user: AuthUser, @id() submissionId: string, @Body() dto: ReasonDto) {
    return this.judging.reject(user, submissionId, dto);
  }

  @Post('submissions/:id/needs-correction')
  @HttpCode(HttpStatus.OK)
  needsCorrection(@CurrentUser() user: AuthUser, @id() submissionId: string, @Body() dto: ReasonDto) {
    return this.judging.needsCorrection(user, submissionId, dto);
  }

  @Post('submissions/:id/penalty')
  @HttpCode(HttpStatus.OK)
  penalty(@CurrentUser() user: AuthUser, @id() submissionId: string, @Body() dto: PenaltyDto) {
    return this.judging.penalize(user, submissionId, dto);
  }

  @Post('submissions/:id/adjust-score')
  @HttpCode(HttpStatus.OK)
  adjust(@CurrentUser() user: AuthUser, @id() submissionId: string, @Body() dto: AdjustScoreDto) {
    return this.judging.adjust(user, submissionId, dto);
  }

  @Post('appeals/:id')
  @HttpCode(HttpStatus.OK)
  decideAppeal(@CurrentUser() user: AuthUser, @id() appealId: string, @Body() dto: AppealDecisionDto) {
    return this.judging.decideAppeal(user, appealId, dto);
  }
}

/**
 * Admin panel → Competitions (§55): the same services behind admin-audience tokens (password + TOTP), so the
 * existing web dashboard manages competitions without a second dashboard. Platform admins hold every
 * competition role, the rules stay in the services.
 */
@ApiTags('admin')
@ApiBearerAuth()
@AdminApi()
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('admin/competitions')
export class AdminCompetitionsController {
  constructor(
    private readonly competitions: CompetitionsService,
    private readonly judging: JudgingService,
  ) {}

  @Get() list() {
    return this.competitions.listAll();
  }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CompetitionDto) {
    return this.competitions.create(u, dto);
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @id() cid: string) {
    return this.competitions.get(u, cid);
  }
  @Put(':id') update(@CurrentUser() u: AuthUser, @id() cid: string, @Body() dto: UpdateCompetitionDto) {
    return this.competitions.update(u, cid, dto);
  }
  @Patch(':id/status') status(@CurrentUser() u: AuthUser, @id() cid: string, @Body() dto: StatusDto) {
    return this.competitions.setStatus(u, cid, dto.status);
  }
  @Get(':id/dashboard') dashboard(@CurrentUser() u: AuthUser, @id() cid: string) {
    return this.competitions.dashboard(u, cid);
  }
  @Post(':id/categories') addCategory(@CurrentUser() u: AuthUser, @id() cid: string, @Body() dto: CategoryDto) {
    return this.competitions.addCategory(u, cid, dto);
  }
  @Post(':id/categories/templates') templates(@CurrentUser() u: AuthUser, @id() cid: string) {
    return this.competitions.addTemplateCategories(u, cid);
  }
  @Put(':id/categories/:categoryId') updateCategory(@CurrentUser() u: AuthUser, @id() cid: string, @id('categoryId') catId: string, @Body() dto: UpdateCategoryDto) {
    return this.competitions.updateCategory(u, cid, catId, dto);
  }
  @Post(':id/wods') addWod(@CurrentUser() u: AuthUser, @id() cid: string, @Body() dto: WorkoutDto) {
    return this.competitions.addWorkout(u, cid, dto);
  }
  @Put(':id/wods/:wodId') updateWod(@CurrentUser() u: AuthUser, @id() cid: string, @id('wodId') wodId: string, @Body() dto: WorkoutDto) {
    return this.competitions.updateWorkout(u, cid, wodId, dto);
  }
  @Post(':id/prizes') addPrize(@CurrentUser() u: AuthUser, @id() cid: string, @Body() dto: PrizeDto) {
    return this.competitions.addPrize(u, cid, dto);
  }
  @Get(':id/coupons') coupons(@CurrentUser() u: AuthUser, @id() cid: string) {
    return this.competitions.listCoupons(u, cid);
  }
  @Post(':id/coupons') addCoupon(@CurrentUser() u: AuthUser, @id() cid: string, @Body() dto: CouponDto) {
    return this.competitions.addCoupon(u, cid, dto);
  }
  @Post(':id/coupons/:couponId/:action') @HttpCode(HttpStatus.OK) toggleCoupon(@CurrentUser() u: AuthUser, @id() cid: string, @id('couponId') couponId: string, @Param('action') action: string) {
    return this.competitions.setCouponActive(u, cid, couponId, action === 'activate');
  }
  @Get(':id/staff') staff(@CurrentUser() u: AuthUser, @id() cid: string) {
    return this.competitions.listStaff(u, cid);
  }
  @Post(':id/staff') addStaff(@CurrentUser() u: AuthUser, @id() cid: string, @Body() dto: StaffDto) {
    return this.competitions.addStaff(u, cid, dto);
  }
  @Post(':id/judge-assignments') assign(@CurrentUser() u: AuthUser, @id() cid: string, @Body() dto: AssignmentDto) {
    return this.competitions.assign(u, cid, dto);
  }
  @Get(':id/registrations') registrations(@CurrentUser() u: AuthUser, @id() cid: string) {
    return this.competitions.registrations(u, cid);
  }
  @Post(':id/registrations/:registrationId/mark-paid') @HttpCode(HttpStatus.OK) markPaid(@CurrentUser() u: AuthUser, @id() cid: string, @id('registrationId') rid: string) {
    return this.competitions.markPaid(u, cid, rid);
  }
  @Get(':id/leaderboard') leaderboard(@id() cid: string, @Query() q: LeaderboardQueryDto) {
    return q.categoryId ? this.judging.leaderboard(cid, q.categoryId, q.workoutId) : { rows: [] };
  }
  @Get(':id/submissions') submissions(@CurrentUser() u: AuthUser, @id() cid: string, @Query() q: JudgeQueueQueryDto) {
    return this.judging.queue(u, { ...q, competitionId: cid });
  }
  @Get(':id/appeals') appeals(@CurrentUser() u: AuthUser, @id() cid: string) {
    return this.judging.appeals(u, cid);
  }
  @Post(':id/publish-leaderboard') @HttpCode(HttpStatus.OK) publish(@CurrentUser() u: AuthUser, @id() cid: string) {
    return this.judging.publish(u, cid);
  }
}
