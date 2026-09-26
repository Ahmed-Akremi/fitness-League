import { ApiPropertyOptional } from '@nestjs/swagger';
import { ExperienceLevel, Gender, Locale, Theme, Visibility } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 80)
  fullName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(280)
  bio?: string | null;

  @ApiPropertyOptional({ enum: Gender, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsEnum(Gender)
  gender?: Gender | null;

  @ApiPropertyOptional({ description: 'Must be sent together with cityId.' })
  @IsOptional()
  @IsUUID()
  governorateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cityId?: string;

  @ApiPropertyOptional({ enum: ExperienceLevel, description: 'A hint only: the scoring engine derives the real level (docs §5.4).' })
  @IsOptional()
  @IsEnum(ExperienceLevel)
  experienceLevelDeclared?: ExperienceLevel;

  @ApiPropertyOptional({ minimum: 1, maximum: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  plannedTrainingDaysPerWeek?: number;
}

export class UpdateSettingsDto {
  @ApiPropertyOptional({ enum: Locale })
  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;

  @ApiPropertyOptional({ enum: Theme })
  @IsOptional()
  @IsEnum(Theme)
  theme?: Theme;

  @ApiPropertyOptional({ nullable: true, description: 'null = follow the OS setting.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsBoolean()
  reducedMotion?: boolean | null;

  @ApiPropertyOptional({ enum: Visibility })
  @IsOptional()
  @IsEnum(Visibility)
  defaultVisibility?: Visibility;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showAgeBracket?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showOnLeaderboards?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 4, description: 'Planned rest days per week that never break a streak.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  streakFreezeDaysPerWeek?: number;
}
