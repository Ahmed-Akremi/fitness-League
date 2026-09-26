import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GoalType, Visibility } from '@prisma/client';
import { IsEnum, IsISO8601, IsNumber, IsOptional, IsPositive, IsUUID, Matches, Max } from 'class-validator';

export class CreateGoalDto {
  @ApiProperty({ enum: GoalType })
  @IsEnum(GoalType)
  type!: GoalType;

  @ApiPropertyOptional({ description: 'Required for STRENGTH and RUNNING goals.' })
  @IsOptional()
  @IsUUID()
  exerciseId?: string;

  @ApiProperty({ example: 'E1RM', description: 'STRENGTH: E1RM | MAX_WEIGHT | MAX_REPS · RUNNING: TIME_5K… | DISTANCE · WEIGHT: BODY_WEIGHT · HABIT: WORKOUTS_PER_WEEK' })
  @Matches(/^[A-Z0-9_]{2,40}$/)
  metricCode!: string;

  @ApiProperty({ example: 120 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1_000_000)
  targetValue!: number;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsISO8601({ strict: true })
  targetDate?: string;

  @ApiPropertyOptional({ enum: Visibility })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @ApiPropertyOptional({ description: 'True when the user picked one of the suggestions.' })
  @IsOptional()
  wasSuggested?: boolean;
}

export class UpdateGoalDto {
  @ApiPropertyOptional({ example: '2027-01-31' })
  @IsOptional()
  @IsISO8601({ strict: true })
  targetDate?: string;

  @ApiPropertyOptional({ enum: Visibility })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;
}

export class SuggestGoalDto {
  @ApiProperty({ enum: [GoalType.STRENGTH, GoalType.RUNNING] })
  @IsEnum([GoalType.STRENGTH, GoalType.RUNNING])
  type!: GoalType;

  @ApiProperty()
  @IsUUID()
  exerciseId!: string;

  @ApiProperty({ example: 'E1RM' })
  @Matches(/^[A-Z0-9_]{2,40}$/)
  metricCode!: string;
}
