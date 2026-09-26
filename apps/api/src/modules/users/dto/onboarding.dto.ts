import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConsentType, DataSource } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class OnboardingSportsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(9)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  sportIds!: string[];

  @ApiProperty()
  @IsUUID()
  primarySportId!: string;
}

export class DeclaredBaselineDto {
  @ApiProperty()
  @IsUUID()
  exerciseId!: string;

  @ApiProperty({ example: 'E1RM' })
  @Matches(/^[A-Z0-9_]{2,40}$/)
  metricCode!: string;

  @ApiProperty({ description: 'In the metric unit (kg, m, s, count).' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(1_000_000)
  value!: number;
}

export class OnboardingBaselinesDto {
  @ApiProperty({ type: [DeclaredBaselineDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => DeclaredBaselineDto)
  entries!: DeclaredBaselineDto[];
}

export class ConsentUpdateDto {
  @ApiProperty({ enum: [ConsentType.HEALTH_DATA, ConsentType.MARKETING], description: 'Terms and privacy cannot be withdrawn in-app (delete the account instead).' })
  @IsEnum([ConsentType.HEALTH_DATA, ConsentType.MARKETING])
  type!: ConsentType;

  @ApiProperty()
  @IsBoolean()
  granted!: boolean;

  @ApiProperty({ example: '2026-09' })
  @IsString()
  @Length(1, 20)
  documentVersion!: string;
}

export class BodyMeasurementDto {
  @ApiProperty({ example: 78.4 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(25)
  @Max(350)
  weightKg!: number;

  @ApiPropertyOptional({ example: 18.5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(2)
  @Max(70)
  bodyFatPct?: number;

  @ApiPropertyOptional({ description: 'Defaults to now.' })
  @IsOptional()
  @IsISO8601()
  measuredAt?: string;

  @ApiPropertyOptional({ enum: DataSource })
  @IsOptional()
  @IsEnum(DataSource)
  source?: DataSource;
}
