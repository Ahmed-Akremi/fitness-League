import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExperienceLevel, LoggingMode, Role, SportCategory, UserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  NotEquals,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

export class ListUsersQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Email, username or name contains' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class UpdateUserStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'BANNED'] })
  @IsIn(['ACTIVE', 'SUSPENDED', 'BANNED'])
  status!: 'ACTIVE' | 'SUSPENDED' | 'BANNED';

  @ApiPropertyOptional({ description: 'End of a temporary suspension.' })
  @IsOptional()
  @IsISO8601()
  until?: string;

  @ApiProperty({ description: 'Shown in the audit log.' })
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class UpdateUserRoleDto {
  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role!: Role;
}

export class CreateDraftDto {
  @ApiPropertyOptional({ description: 'Version to clone (defaults to the active one).' })
  @IsOptional()
  @IsInt()
  basedOn?: number;

  @ApiProperty()
  @IsString()
  @Length(3, 500)
  changeNote!: string;
}

export class UpdateDraftDto {
  @ApiProperty({ description: 'Full rule-set document (validated against the schema).' })
  @IsObject()
  config!: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 500)
  changeNote?: string;
}

export class ExpectedProgressionRowDto {
  @ApiProperty({ enum: ExperienceLevel })
  @IsEnum(ExperienceLevel)
  level!: ExperienceLevel;

  @ApiPropertyOptional({ description: 'Exercise code; omit for the generic row of the metric.' })
  @IsOptional()
  @Matches(/^[A-Z0-9_]{2,40}$/)
  exercise?: string;

  @ApiProperty()
  @Matches(/^[A-Z0-9_]{2,40}$/)
  metric!: string;

  @ApiProperty({ description: '% per progress window (28 days).' })
  @IsNumber()
  @Min(0.01)
  @Max(100)
  pct!: number;
}

export class ReplaceExpectedProgressionDto {
  @ApiProperty({ type: [ExpectedProgressionRowDto] })
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ExpectedProgressionRowDto)
  rows!: ExpectedProgressionRowDto[];
}

export class CreateSeasonDto {
  @ApiProperty({ example: 'Season 2027 Q1' })
  @IsString()
  @Length(3, 60)
  name!: string;

  @ApiProperty()
  @IsISO8601()
  startsAt!: string;

  @ApiProperty()
  @IsISO8601()
  endsAt!: string;
}

export class SportDto {
  @ApiProperty()
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  code!: string;

  @ApiProperty({ enum: SportCategory })
  @IsEnum(SportCategory)
  category!: SportCategory;

  @ApiProperty({ enum: LoggingMode })
  @IsEnum(LoggingMode)
  loggingMode!: LoggingMode;

  @ApiProperty({ example: { fr: 'Boxe', en: 'Boxing', ar: 'ملاكمة' } })
  @IsObject()
  name!: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ExerciseDto {
  @ApiProperty()
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  code!: string;

  @ApiPropertyOptional({ description: 'Null = shared by strength/functional sports.' })
  @IsOptional()
  @IsUUID()
  sportId?: string | null;

  @ApiProperty()
  @IsObject()
  name!: Record<string, string>;

  @ApiProperty()
  @IsBoolean()
  isBodyweight!: boolean;

  @ApiProperty({ example: ['MAX_WEIGHT', 'E1RM'] })
  @IsArray()
  @Matches(/^[A-Z0-9_]{2,40}$/, { each: true })
  trackedMetrics!: string[];

  @ApiPropertyOptional({ example: { hold_kg: 150, reject_kg: 240 } })
  @IsOptional()
  @IsObject()
  plausibility?: Record<string, number>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class AuditQueryDto extends PageQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  action?: string;
}

export class LedgerAdjustmentDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;

  @ApiProperty({ enum: ['XP', 'LP'] })
  @IsIn(['XP', 'LP'])
  kind!: 'XP' | 'LP';

  @ApiProperty({ description: 'Non-zero, ±10000 max.' })
  @IsInt()
  @Min(-10_000)
  @Max(10_000)
  @NotEquals(0)
  amount!: number;

  @ApiProperty()
  @IsString()
  @Length(5, 500)
  reason!: string;
}

export class RecomputeDto {
  @ApiProperty({ example: '2026-10-05', description: 'First week (Monday, business calendar) to re-score' })
  @IsISO8601()
  from!: string;

  @ApiProperty({ example: '2026-11-02', description: 'Exclusive end week' })
  @IsISO8601()
  to!: string;

  @ApiPropertyOptional({ default: true, description: 'Report the changes without writing anything' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiProperty({ example: 'Rule set v3: consistency weight fix' })
  @IsString()
  @Length(5, 300)
  reason!: string;
}

export class CreateJudgeDto {
  @ApiProperty({ example: 'judge.sousse@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'judge_sousse' })
  @Matches(/^[a-z0-9_.]{3,20}$/)
  username!: string;

  @ApiProperty({ enum: ['JUDGE', 'HEAD_JUDGE'] })
  @IsIn(['JUDGE', 'HEAD_JUDGE'])
  role!: 'JUDGE' | 'HEAD_JUDGE';
}
