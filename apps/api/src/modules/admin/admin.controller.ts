import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '../../common/auth/auth-user';
import { AdminApi, CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { AuthService } from '../auth/auth.service';
import { RefreshDto } from '../auth/dto/auth.dto';
import { AdminAuthService } from './admin-auth.service';
import { AdminService } from './admin.service';
import { AdminLoginDto, TotpConfirmDto } from './dto/admin-auth.dto';
import {
  AuditQueryDto,
  CreateDraftDto,
  CreateSeasonDto,
  ExerciseDto,
  LedgerAdjustmentDto,
  ListUsersQueryDto,
  ReplaceExpectedProgressionDto,
  SportDto,
  UpdateDraftDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
} from './dto/admin.dto';

const ctx = (req: Request & { id?: unknown }) => ({ requestId: req.id !== undefined ? String(req.id) : undefined });

@ApiTags('admin-auth')
@Public()
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly auth: AuthService,
  ) {}

  /** Step 1: password (+ code). First time: returns a TOTP enrolment instead of a session. */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'admin-login-ip', limit: 10, windowS: 60, by: 'ip' }, { name: 'admin-login-account', limit: 5, windowS: 900, by: 'body.email' })
  login(@Body() dto: AdminLoginDto, @Req() req: Request) {
    return this.adminAuth.login(dto.email, dto.password, dto.code, ctx(req));
  }

  @Post('totp/confirm')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'admin-totp', limit: 10, windowS: 900, by: 'ip' })
  confirm(@Body() dto: TotpConfirmDto, @Req() req: Request) {
    return this.adminAuth.confirmTotp(dto.setupToken, dto.code, ctx(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, ctx(req), 'admin');
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@AdminApi()
@Roles('MODERATOR', 'ADMIN', 'SUPER_ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly auth: AuthService,
  ) {}

  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@CurrentUser() user: AuthUser, @Body() dto: RefreshDto): Promise<void> {
    return this.auth.logout(user.id, dto.refreshToken);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.admin.user(user.id);
  }

  @Get('stats/overview')
  overview() {
    return this.admin.overview();
  }

  // Users — moderators can read and suspend; banning and roles need admins.
  @Get('users')
  users(@Query() q: ListUsersQueryDto) {
    return this.admin.users(q);
  }

  @Get('users/:id')
  user(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.user(id);
  }

  @Patch('users/:id/status')
  status(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserStatusDto) {
    return this.admin.setStatus(actor, id, dto);
  }

  @Patch('users/:id/role')
  @Roles('ADMIN', 'SUPER_ADMIN')
  role(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserRoleDto) {
    return this.admin.setRole(actor, id, dto);
  }

  // Rule sets
  @Get('rule-sets')
  @Roles('ADMIN', 'SUPER_ADMIN')
  ruleSets() {
    return this.admin.ruleSetList();
  }

  @Get('rule-sets/:version')
  @Roles('ADMIN', 'SUPER_ADMIN')
  ruleSet(@Param('version', ParseIntPipe) version: number) {
    return this.admin.ruleSet(version);
  }

  @Post('rule-sets')
  @Roles('ADMIN', 'SUPER_ADMIN')
  createDraft(@CurrentUser() actor: AuthUser, @Body() dto: CreateDraftDto) {
    return this.admin.createDraft(actor, dto);
  }

  @Put('rule-sets/:version')
  @Roles('ADMIN', 'SUPER_ADMIN')
  updateDraft(@CurrentUser() actor: AuthUser, @Param('version', ParseIntPipe) version: number, @Body() dto: UpdateDraftDto) {
    return this.admin.updateDraft(actor, version, dto);
  }

  @Get('rule-sets/:version/expected-progression')
  @Roles('ADMIN', 'SUPER_ADMIN')
  expected(@Param('version', ParseIntPipe) version: number) {
    return this.admin.expectedProgression(version);
  }

  @Put('rule-sets/:version/expected-progression')
  @Roles('ADMIN', 'SUPER_ADMIN')
  replaceExpected(@CurrentUser() actor: AuthUser, @Param('version', ParseIntPipe) version: number, @Body() dto: ReplaceExpectedProgressionDto) {
    return this.admin.replaceExpectedProgression(actor, version, dto);
  }

  @Post('rule-sets/:version/validate')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN', 'SUPER_ADMIN')
  validate(@Param('version', ParseIntPipe) version: number) {
    return this.admin.validate(version);
  }

  /** Q-10: only super admins switch the scoring rules. */
  @Post('rule-sets/:version/activate')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  activate(@CurrentUser() actor: AuthUser, @Param('version', ParseIntPipe) version: number) {
    return this.admin.activate(actor, version);
  }

  // Seasons
  @Get('seasons')
  @Roles('ADMIN', 'SUPER_ADMIN')
  seasons() {
    return this.admin.seasonList();
  }

  @Post('seasons')
  @Roles('ADMIN', 'SUPER_ADMIN')
  createSeason(@CurrentUser() actor: AuthUser, @Body() dto: CreateSeasonDto) {
    return this.admin.createSeason(actor, dto);
  }

  @Post('seasons/:id/close')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN', 'SUPER_ADMIN')
  closeSeason(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.closeSeason(actor, id);
  }

  // Catalog (data-driven sports/exercises, spec §7)
  @Put('sports')
  @Roles('ADMIN', 'SUPER_ADMIN')
  sport(@CurrentUser() actor: AuthUser, @Body() dto: SportDto) {
    return this.admin.upsertSport(actor, dto);
  }

  @Put('exercises')
  @Roles('ADMIN', 'SUPER_ADMIN')
  exercise(@CurrentUser() actor: AuthUser, @Body() dto: ExerciseDto) {
    return this.admin.upsertExercise(actor, dto);
  }

  // Audit & ledger
  @Get('audit-logs')
  @Roles('ADMIN', 'SUPER_ADMIN')
  auditLogs(@Query() q: AuditQueryDto) {
    return this.admin.auditLogs(q);
  }

  @Post('ledger/adjustments')
  @Roles('ADMIN', 'SUPER_ADMIN')
  adjust(@CurrentUser() actor: AuthUser, @Body() dto: LedgerAdjustmentDto) {
    return this.admin.adjust(actor, dto);
  }
}
