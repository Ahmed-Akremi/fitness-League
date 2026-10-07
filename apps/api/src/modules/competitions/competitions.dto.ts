import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CategoryGender,
  CompetitionFormat,
  CompetitionPenaltyType,
  CompetitionScoreType,
  CompetitionScoringMethod,
  CompetitionStaffRole,
  CompetitionStatus,
  CouponType,
  PrizeType,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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
  Min,
  ValidateNested,
} from 'class-validator';

const FORMATS = Object.values(CompetitionFormat);
const STATUSES = Object.values(CompetitionStatus);
const GENDERS = Object.values(CategoryGender);
const SCORE_TYPES = Object.values(CompetitionScoreType);
const METHODS = Object.values(CompetitionScoringMethod);
const STAFF_ROLES = Object.values(CompetitionStaffRole);
const COUPON_TYPES = Object.values(CouponType);
const PRIZE_TYPES = Object.values(PrizeType);
const PENALTY_TYPES = Object.values(CompetitionPenaltyType);

export class CompetitionDto {
  @ApiProperty({ example: 'Tunisia Functional Fitness Championship' }) @IsString() @Length(3, 120) title!: string;
  @ApiProperty({ example: 'tunisia-ff-2026' }) @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @Length(3, 80) slug!: string;
  @ApiProperty() @IsString() @Length(1, 5000) description!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() logoMediaId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) location?: string;
  @ApiPropertyOptional({ example: 'TN' }) @IsOptional() @Matches(/^[A-Z]{2}$/) countryCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 100) city?: string;
  @ApiProperty({ enum: FORMATS }) @IsIn(FORMATS) format!: CompetitionFormat;
  @ApiProperty() @IsISO8601() registrationStart!: string;
  @ApiProperty() @IsISO8601() registrationEnd!: string;
  @ApiProperty() @IsISO8601() eventStart!: string;
  @ApiProperty() @IsISO8601() eventEnd!: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() scoreSubmissionStart?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() scoreSubmissionDeadline?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() judgingDeadline?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() appealDeadline?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() leaderboardPublicationAt?: string;
  @ApiProperty({ description: 'Minor units (35 TND = 35000).', example: 35000 }) @IsInt() @Min(0) @Max(100_000_000) registrationPrice!: number;
  @ApiPropertyOptional({ example: 'TND' }) @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) maxParticipants?: number;
  @ApiPropertyOptional({ description: 'Ordered TieBreakRule[] (see domain.ts).' }) @IsOptional() @IsArray() tieBreakRules?: object[];
}

export class UpdateCompetitionDto implements Partial<CompetitionDto> {
  @IsOptional() @IsString() @Length(3, 120) title?: string;
  @IsOptional() @IsString() @Length(1, 5000) description?: string;
  @IsOptional() @IsUUID() logoMediaId?: string;
  @IsOptional() @IsString() @Length(0, 200) location?: string;
  @IsOptional() @IsString() @Length(0, 100) city?: string;
  @IsOptional() @IsIn(FORMATS) format?: CompetitionFormat;
  @IsOptional() @IsISO8601() registrationStart?: string;
  @IsOptional() @IsISO8601() registrationEnd?: string;
  @IsOptional() @IsISO8601() eventStart?: string;
  @IsOptional() @IsISO8601() eventEnd?: string;
  @IsOptional() @IsISO8601() scoreSubmissionStart?: string;
  @IsOptional() @IsISO8601() scoreSubmissionDeadline?: string;
  @IsOptional() @IsISO8601() judgingDeadline?: string;
  @IsOptional() @IsISO8601() appealDeadline?: string;
  @IsOptional() @IsISO8601() leaderboardPublicationAt?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) registrationPrice?: number;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsInt() @Min(1) maxParticipants?: number;
  @IsOptional() @IsArray() tieBreakRules?: object[];
}

export class StatusDto {
  @ApiProperty({ enum: STATUSES }) @IsIn(STATUSES) status!: CompetitionStatus;
}

export class ListCompetitionsQueryDto {
  /** CURRENT: published and not over (home carousel). */
  @ApiPropertyOptional({ enum: ['ALL', 'CURRENT', 'REGISTRATION_OPEN', 'UPCOMING', 'ACTIVE', 'FINISHED'] })
  @IsOptional()
  @IsIn(['ALL', 'CURRENT', 'REGISTRATION_OPEN', 'UPCOMING', 'ACTIVE', 'FINISHED'])
  filter?: 'ALL' | 'CURRENT' | 'REGISTRATION_OPEN' | 'UPCOMING' | 'ACTIVE' | 'FINISHED';
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) mine?: 'true' | 'false';
}

export class CategoryDto {
  @ApiProperty({ example: 'RX Male Division 18-35' }) @IsString() @Length(2, 120) name!: string;
  @ApiProperty({ enum: GENDERS }) @IsIn(GENDERS) gender!: CategoryGender;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(120) minAge?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(120) maxAge?: number;
  @ApiPropertyOptional({ example: 'RX' }) @IsOptional() @IsString() @Length(0, 40) level?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) maxParticipants?: number;
  @ApiPropertyOptional({ description: 'Minor units; empty = competition price.' }) @IsOptional() @IsInt() @Min(0) registrationPriceOverride?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdateCategoryDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsIn(GENDERS) gender?: CategoryGender;
  @IsOptional() @IsInt() @Min(0) @Max(120) minAge?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(120) maxAge?: number | null;
  @IsOptional() @IsString() @Length(0, 40) level?: string;
  @IsOptional() @IsInt() @Min(1) maxParticipants?: number | null;
  @IsOptional() @IsInt() @Min(0) registrationPriceOverride?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class VariantDto {
  @IsUUID() categoryId!: string;
  @IsString() @Length(1, 5000) description!: string;
  @IsOptional() @IsString() @Length(0, 5000) standards?: string;
  @IsOptional() @IsInt() @Min(60) timeCapS?: number;
}

/** A WOD movement and its value per rep; MOVEMENT_REPS WODs score Σ reps × pointsPerRep. */
export class MovementDto {
  @ApiProperty({ example: 'Burpees' }) @IsString() @Length(1, 80) name!: string;
  @ApiProperty({ example: 1 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000) pointsPerRep!: number;
}

export class WorkoutDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) @Max(100) number!: number;
  @ApiProperty({ example: 'WOD 1' }) @IsString() @Length(1, 80) name!: string;
  @ApiProperty() @IsString() @Length(1, 5000) description!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 5000) standards?: string;
  @ApiPropertyOptional({ type: [MovementDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MovementDto) movements?: MovementDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) videoUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() imageMediaId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(60) timeCapS?: number;
  @ApiProperty({ enum: SCORE_TYPES }) @IsIn(SCORE_TYPES) scoreType!: CompetitionScoreType;
  @ApiProperty({ enum: METHODS }) @IsIn(METHODS) scoringMethod!: CompetitionScoringMethod;
  @ApiProperty({ example: 100 }) @IsInt() @Min(1) @Max(100_000) maximumPoints!: number;
  @ApiPropertyOptional({ example: 0 }) @IsOptional() @IsInt() @Min(0) minimumPoints?: number;
  @ApiPropertyOptional({ example: [100, 95, 90, 85, 80] }) @IsOptional() @IsArray() @IsInt({ each: true }) placementTable?: number[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() categorySpecific?: boolean;
  @ApiPropertyOptional({ type: [VariantDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => VariantDto) variants?: VariantDto[];
  @ApiPropertyOptional() @IsOptional() @IsISO8601() releaseAt?: string;
  @ApiProperty() @IsISO8601() submissionStart!: string;
  @ApiProperty() @IsISO8601() submissionDeadline!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

export class ReorderDto {
  @ApiProperty({ description: 'Workout ids in their new order.' }) @IsArray() @IsUUID('all', { each: true }) workoutIds!: string[];
}

export class StaffDto {
  @IsUUID() userId!: string;
  @IsIn(STAFF_ROLES) role!: CompetitionStaffRole;
}

export class AssignmentDto {
  @IsUUID() staffId!: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() workoutId?: string;
}

export class PrizeDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsInt() @Min(1) @Max(100) position!: number;
  @IsIn(PRIZE_TYPES) type!: PrizeType;
  @IsOptional() @IsInt() @Min(0) amount?: number;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsString() @Length(0, 500) description?: string;
}

export class CouponDto {
  @ApiProperty({ example: 'FREE2026' }) @Matches(/^[A-Z0-9_-]{3,32}$/) code!: string;
  @ApiProperty({ enum: COUPON_TYPES }) @IsIn(COUPON_TYPES) type!: CouponType;
  @ApiPropertyOptional({ description: 'PERCENTAGE 1–100, FIXED_AMOUNT in minor units.' }) @IsOptional() @IsInt() @Min(0) value?: number;
  @IsOptional() @IsInt() @Min(1) maxUses?: number;
  @IsOptional() @IsISO8601() expiresAt?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsInt() @Min(0) minimumAmount?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class RegisterDto {
  @ApiProperty() @IsUUID() categoryId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 32) couponCode?: string;
}

export class CouponCheckDto {
  @IsUUID() categoryId!: string;
  @IsString() @Length(1, 32) code!: string;
}

export class SubmissionDto {
  @ApiProperty({ description: 'Client id; a retry with the same id is answered with the stored submission.' }) @IsUUID() clientId!: string;
  @ApiProperty({ description: 'timeS, rounds, reps, value (load/distance/calories/points), remainingTimeS, capped; movementReps (one count per WOD movement) for MOVEMENT_REPS.' }) @IsObject() raw!: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 2000) notes?: string;
  @ApiPropertyOptional({ description: 'YouTube URL, required to submit (not for a draft)' }) @IsOptional() @IsString() @Length(0, 500) videoUrl?: string;
  @ApiPropertyOptional({ description: 'false keeps it as a DRAFT' }) @IsOptional() @IsBoolean() submit?: boolean;
}

export class ReasonDto {
  @IsString() @Length(3, 1000) reason!: string;
}

export class PenaltyDto {
  @IsIn(PENALTY_TYPES) type!: CompetitionPenaltyType;
  @IsNumber() @Min(0) @Max(100_000) points!: number;
  @IsString() @Length(3, 1000) reason!: string;
}

export class AdjustScoreDto {
  @ApiPropertyOptional({ description: 'New raw result (PLACEMENT_POINTS WODs) — e.g. a corrected time.' }) @IsOptional() @IsNumber() rawValue?: number;
  @ApiPropertyOptional({ description: 'New points (DIRECT_POINTS WODs).' }) @IsOptional() @IsNumber() points?: number;
  @IsString() @Length(3, 1000) reason!: string;
}

export class JudgeQueueQueryDto {
  @IsOptional() @IsUUID() competitionId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() workoutId?: string;
  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'PENALIZED', 'ALL']) status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PENALIZED' | 'ALL';
}

export class JudgeAthletesQueryDto {
  @IsOptional() @IsUUID() competitionId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
}

export class AppealDecisionDto {
  @IsIn(['ACCEPTED', 'REJECTED', 'CLOSED']) status!: 'ACCEPTED' | 'REJECTED' | 'CLOSED';
  @IsString() @Length(3, 1000) response!: string;
  @IsOptional() @IsNumber() rawValue?: number;
  @IsOptional() @IsNumber() points?: number;
}

export class LeaderboardQueryDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() workoutId?: string;
}

export class AnnouncementDto {
  @IsString() @Length(3, 120) title!: string;
  @IsString() @Length(1, 5000) body!: string;
}

export class HeatDto {
  @IsOptional() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsUUID() workoutId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsISO8601() startsAt?: string;
  @IsOptional() @IsInt() @Min(1) @Max(600) durationMin?: number;
  @IsOptional() @IsInt() @Min(1) @Max(40) laneCount?: number;
}

export class LaneDto {
  @IsUUID() registrationId!: string;
  @IsInt() @Min(1) @Max(40) lane!: number;
}

export class AutoHeatsDto {
  @IsUUID() categoryId!: string;
  @IsOptional() @IsUUID() workoutId?: string;
  @IsInt() @Min(1) @Max(40) laneCount!: number;
  @IsOptional() @IsISO8601() startsAt?: string;
  @ApiPropertyOptional({ description: 'Minutes between heat starts.' }) @IsOptional() @IsInt() @Min(1) @Max(600) intervalMin?: number;
}
