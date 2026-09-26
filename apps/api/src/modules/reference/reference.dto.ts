import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class CitiesQueryDto {
  @ApiProperty()
  @IsUUID()
  governorateId!: string;
}

export class ExercisesQueryDto {
  @ApiPropertyOptional({ description: 'Exercises of this sport plus the shared ones (e.g. squat for every strength sport).' })
  @IsOptional()
  @IsUUID()
  sportId?: string;

  @ApiPropertyOptional({ description: 'Delta sync for the offline catalog: only rows changed after this instant.' })
  @IsOptional()
  @IsISO8601()
  updatedSince?: string;
}
