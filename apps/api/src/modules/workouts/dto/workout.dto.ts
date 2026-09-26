import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Visibility } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

export class WorkoutSetDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 1000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  reps?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1000, description: 'kg' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  weightKg?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1_000_000, description: 'metres' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  distanceM?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 86_400, description: 'seconds' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400)
  durationS?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isWarmup?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(10)
  rpe?: number;
}

export class WorkoutExerciseDto {
  @ApiProperty()
  @IsUUID()
  exerciseId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ type: [WorkoutSetDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => WorkoutSetDto)
  sets!: WorkoutSetDto[];
}

/** Raw workout data only: the client never sends points (docs §9.1). */
export class WorkoutContentDto {
  @ApiProperty()
  @IsUUID()
  sportId!: string;

  @ApiProperty({ example: 'STRENGTH' })
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  workoutType!: string;

  @ApiProperty({ example: '2026-09-25T07:30:00Z' })
  @IsISO8601({ strict: true })
  performedAt!: string;

  @ApiProperty({ minimum: 60, maximum: 86_400 })
  @IsInt()
  @Min(60)
  @Max(86_400)
  durationS!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ enum: Visibility, description: 'Defaults to the user setting.' })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @ApiProperty({ type: [WorkoutExerciseDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => WorkoutExerciseDto)
  exercises!: WorkoutExerciseDto[];
}

export class CreateWorkoutDto extends WorkoutContentDto {
  @ApiProperty({ description: 'Client-generated UUID; also sent as the Idempotency-Key header.' })
  @IsUUID()
  clientId!: string;

  @ApiPropertyOptional({ description: 'Device clock when the workout was submitted (clock-skew detection).' })
  @IsOptional()
  @IsISO8601()
  deviceSubmittedAt?: string;
}

export class SyncWorkoutsDto {
  @ApiProperty({ type: [CreateWorkoutDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateWorkoutDto)
  items!: CreateWorkoutDto[];
}

export class ListWorkoutsQueryDto extends PageQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sportId?: string;
}
