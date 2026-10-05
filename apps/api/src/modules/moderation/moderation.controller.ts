import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ReportReason, ReportTarget } from '@prisma/client';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type { AuthUser } from '../../common/auth/auth-user';
import { AdminApi, CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { ModerationService, type ReportAction } from './moderation.service';

const TARGETS: ReportTarget[] = ['USER', 'WORKOUT', 'COMMENT', 'GYM'];
const REASONS: ReportReason[] = ['CHEATING', 'HARASSMENT', 'SPAM', 'INAPPROPRIATE', 'IMPERSONATION', 'OTHER'];

export class CreateReportDto {
  @ApiProperty({ enum: TARGETS })
  @IsIn(TARGETS)
  targetType!: ReportTarget;

  @ApiProperty()
  @IsUUID()
  targetId!: string;

  @ApiProperty({ enum: REASONS })
  @IsIn(REASONS)
  reason!: ReportReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  details?: string;
}

export class AppealDto {
  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsString()
  @Length(10, 2000)
  text!: string;
}

export class AppealTokenQuery {
  @ApiProperty()
  @IsString()
  @Length(10, 1000)
  token!: string;
}

export class DecideReportDto {
  @ApiProperty({ enum: ['DISMISS', 'WARN', 'SUSPEND', 'BAN'] })
  @IsIn(['DISMISS', 'WARN', 'SUSPEND', 'BAN'])
  action!: ReportAction;

  @ApiPropertyOptional({ description: 'Suspension length, required for SUSPEND' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  @ApiProperty({ description: 'Shown to the sanctioned athlete' })
  @IsString()
  @Length(5, 1000)
  note!: string;
}

export class DecideAppealDto {
  @ApiProperty({ enum: ['UPHOLD', 'OVERTURN'] })
  @IsIn(['UPHOLD', 'OVERTURN'])
  decision!: 'UPHOLD' | 'OVERTURN';

  @ApiProperty()
  @IsString()
  @Length(5, 1000)
  note!: string;
}

/** Reports and sanctions for athletes (docs §4.5 P3). */
@ApiTags('moderation')
@ApiBearerAuth()
@Controller()
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Post('reports')
  @RateLimit({ name: 'report', limit: 20, windowS: 86_400, by: 'user' })
  report(@CurrentUser() user: AuthUser, @Body() dto: CreateReportDto) {
    return this.moderation.report(user.id, dto);
  }

  @Get('me/reports')
  myReports(@CurrentUser() user: AuthUser) {
    return this.moderation.myReports(user.id);
  }

  @Get('me/sanctions')
  mySanctions(@CurrentUser() user: AuthUser) {
    return this.moderation.mySanctions(user.id);
  }

  @Post('me/sanctions/:id/appeal')
  @HttpCode(HttpStatus.OK)
  appeal(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AppealDto) {
    return this.moderation.appeal(user.id, id, dto.text);
  }

  /** Emailed link for a suspended or banned athlete, who can no longer sign in. */
  @Public()
  @Get('appeals')
  @RateLimit({ name: 'appeal-link', limit: 30, windowS: 3_600, by: 'ip' })
  byToken(@Query() q: AppealTokenQuery) {
    return this.moderation.byToken(q.token);
  }

  @Public()
  @Post('appeals')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'appeal-link', limit: 30, windowS: 3_600, by: 'ip' })
  appealByToken(@Query() q: AppealTokenQuery, @Body() dto: AppealDto) {
    return this.moderation.appealByToken(q.token, dto.text);
  }

  @Get('moderation-log')
  log() {
    return this.moderation.publicLog();
  }
}

/** Moderation queue (docs §4.5 P3). */
@ApiTags('admin')
@ApiBearerAuth()
@AdminApi()
@Roles('MODERATOR', 'ADMIN', 'SUPER_ADMIN')
@Controller('admin')
export class AdminModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('reports')
  reports() {
    return this.moderation.openReports();
  }

  @Post('reports/:id/decide')
  @HttpCode(HttpStatus.OK)
  decide(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideReportDto) {
    return this.moderation.decideReport(actor, id, dto);
  }

  @Get('appeals')
  appeals() {
    return this.moderation.pendingAppeals();
  }

  @Post('sanctions/:id/appeal/decide')
  @HttpCode(HttpStatus.OK)
  decideAppeal(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideAppealDto) {
    return this.moderation.decideAppeal(actor, id, dto.decision, dto.note);
  }
}
