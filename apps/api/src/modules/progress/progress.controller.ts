import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { PERIODS, ProgressQueryService } from './progress-query.service';
import type { Period } from './progress-query.service';

class PeriodQueryDto {
  @ApiPropertyOptional({ enum: Object.keys(PERIODS), default: '30d' })
  @IsOptional()
  @IsIn(Object.keys(PERIODS))
  period: Period = '30d';
}

@ApiTags('progress')
@ApiBearerAuth()
@Controller('me')
export class ProgressController {
  constructor(private readonly progress: ProgressQueryService) {}

  @Get('progress')
  overview(@CurrentUser() user: AuthUser, @Query() q: PeriodQueryDto) {
    return this.progress.overview(user.id, q.period);
  }

  @Get('progress/metrics/:exerciseId/:metricCode')
  series(@CurrentUser() user: AuthUser, @Param('exerciseId', ParseUUIDPipe) exerciseId: string, @Param('metricCode') metricCode: string, @Query() q: PeriodQueryDto) {
    return this.progress.series(user.id, exerciseId, metricCode, q.period);
  }

  @Get('records')
  records(@CurrentUser() user: AuthUser) {
    return this.progress.records(user.id);
  }

  @Get('baselines')
  baselines(@CurrentUser() user: AuthUser) {
    return this.progress.baselines(user.id);
  }
}
