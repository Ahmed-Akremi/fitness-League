import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeagueScoringPreset, LeagueVisibility } from '@prisma/client';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateLeagueDto {
  @ApiProperty({ example: 'Lac 2 lifters' })
  @IsString()
  @Length(3, 60)
  name!: string;

  @ApiPropertyOptional({ enum: ['PRIVATE', 'PUBLIC'], default: 'PRIVATE' })
  @IsOptional()
  @IsIn(['PRIVATE', 'PUBLIC'])
  visibility?: LeagueVisibility;

  @ApiPropertyOptional({ enum: ['STANDARD', 'CONSISTENCY', 'PROGRESS'], default: 'STANDARD' })
  @IsOptional()
  @IsIn(['STANDARD', 'CONSISTENCY', 'PROGRESS'])
  scoringPreset?: LeagueScoringPreset;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(200)
  maxMembers?: number;

  @ApiPropertyOptional({ description: 'Defaults to the start of the current week' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiProperty({ example: '2026-12-31T23:00:00Z' })
  @IsISO8601()
  endsAt!: string;
}

export class JoinByCodeDto {
  @ApiProperty({ example: 'K7MX2PQA' })
  @IsString()
  @Length(4, 16)
  code!: string;
}
