import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WodDivision, WodScoreType } from '@prisma/client';
import { IsEnum, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

export class CreateGymWodDto {
  @ApiProperty({ example: 'Bodynade Burner' })
  @IsString()
  @Length(3, 80)
  title!: string;

  @ApiProperty({ example: '21-15-9 thrusters 43/29 kg, bar-facing burpees' })
  @IsString()
  @Length(1, 2000)
  description!: string;

  @ApiProperty({ enum: WodScoreType })
  @IsEnum(WodScoreType)
  scoreType!: WodScoreType;

  @ApiPropertyOptional({ minimum: 60, maximum: 14_400 })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(4 * 3600)
  timeCapS?: number;

  @ApiProperty()
  @IsISO8601({ strict: true })
  startsAt!: string;

  @ApiProperty()
  @IsISO8601({ strict: true })
  endsAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sportId?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED'])
  status?: 'DRAFT' | 'PUBLISHED';
}

export class UpdateGymWodDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 80)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(4 * 3600)
  timeCapS?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
}

export class ListGymWodsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'upcoming', 'past'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'upcoming', 'past'])
  when: 'active' | 'upcoming' | 'past' = 'active';
}

export class SubmitWodScoreDto {
  @ApiProperty({ enum: WodDivision })
  @IsEnum(WodDivision)
  division!: WodDivision;

  @ApiPropertyOptional({ description: 'FOR_TIME: seconds.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4 * 3600)
  timeS?: number;

  @ApiPropertyOptional({ description: 'AMRAP: completed rounds (display only).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  rounds?: number;

  @ApiPropertyOptional({ description: 'AMRAP: total reps (rounds × reps per round + extra reps). Ranked value.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5000)
  reps?: number;

  @ApiPropertyOptional({ description: 'MAX_LOAD: kg.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(500)
  loadKg?: number;

  @ApiProperty()
  @IsISO8601({ strict: true })
  performedAt!: string;

  @ApiProperty({ description: 'Client-generated UUID; makes the linked workout idempotent.' })
  @IsUUID()
  clientId!: string;
}

export class WodLeaderboardQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: WodDivision, default: 'RX' })
  @IsOptional()
  @IsEnum(WodDivision)
  division: WodDivision = 'RX';
}

export class InvalidateScoreDto {
  @ApiProperty()
  @IsString()
  @Length(3, 300)
  reason!: string;
}
