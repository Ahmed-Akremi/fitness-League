import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChallengeScope } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { CHALLENGE_METRICS, type ChallengeMetric } from './challenge-metrics';

const SCOPES: ChallengeScope[] = ['PERSONAL', 'FRIEND', 'COMMUNITY', 'GYM'];

export class CreateChallengeDto {
  @ApiProperty({ enum: SCOPES })
  @IsIn(SCOPES)
  scope!: ChallengeScope;

  @ApiProperty({ example: '12 sessions in November' })
  @IsString()
  @Length(3, 80)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @ApiProperty({ enum: CHALLENGE_METRICS })
  @IsIn(CHALLENGE_METRICS)
  metric!: ChallengeMetric;

  @ApiProperty({ example: 12 })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(1_000_000)
  targetValue!: number;

  @ApiProperty({ example: '2026-11-01T00:00:00+01:00' })
  @IsISO8601()
  startsAt!: string;

  @ApiProperty({ example: '2026-12-01T00:00:00+01:00' })
  @IsISO8601()
  endsAt!: string;

  @ApiPropertyOptional({ description: 'Required for GYM challenges' })
  @IsOptional()
  @IsUUID()
  gymId?: string;
}

export class ListChallengesQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'ENDED'], default: 'ACTIVE' })
  @IsOptional()
  @IsIn(['ACTIVE', 'ENDED'])
  status?: 'ACTIVE' | 'ENDED';

  @ApiPropertyOptional({ enum: SCOPES })
  @IsOptional()
  @IsIn(SCOPES)
  scope?: ChallengeScope;

  @ApiPropertyOptional({ description: 'Only challenges I joined' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  mine?: boolean;
}
