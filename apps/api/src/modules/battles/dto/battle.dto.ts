import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BattleStatus } from '@prisma/client';
import { ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

export const BATTLE_COMPONENTS = ['progress', 'consistency', 'performance'] as const;
export type BattleComponent = (typeof BATTLE_COMPONENTS)[number];

export class CreateBattleDto {
  @ApiProperty({ description: 'A friend (accepted friendship).' })
  @IsUUID()
  opponentId!: string;

  @ApiPropertyOptional({ minimum: 3, maximum: 14, default: 7 })
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(14)
  durationDays: number = 7;

  @ApiPropertyOptional({
    enum: BATTLE_COMPONENTS,
    isArray: true,
    description: 'Which score components count (Q-16: components only, never raw performance, so different sports stay comparable).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(BATTLE_COMPONENTS, { each: true })
  components?: BattleComponent[];
}

export class ListBattlesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: BattleStatus })
  @IsOptional()
  @IsEnum(BattleStatus)
  status?: BattleStatus;
}
