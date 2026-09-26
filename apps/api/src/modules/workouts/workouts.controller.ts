import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../../common/auth/auth-user';
import { AdminApi, CurrentUser, Roles } from '../../common/auth/decorators';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { PageQueryDto } from '../../common/pagination/page';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { CreateWorkoutDto, ListWorkoutsQueryDto, SyncWorkoutsDto, WorkoutContentDto } from './dto/workout.dto';
import { ReviewDto } from './dto/review.dto';
import { CreateResult, WorkoutsService, WorkoutView } from './workouts.service';

function rejected(workout: WorkoutView): AppException {
  return new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.WORKOUT_REJECTED, 'Workout rejected', {
    detail: 'This workout exceeds physiological limits or duplicates another one.',
    extra: { workout },
  });
}

@ApiTags('workouts')
@ApiBearerAuth()
@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workouts: WorkoutsService) {}

  @Post()
  @RateLimit({ name: 'workouts', limit: 30, windowS: 3600, by: 'user' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Must equal body.clientId.' })
  @ApiOkResponse({ description: '201 created, 200 idempotent replay, 409 same clientId with different data, 422 WORKOUT_REJECTED.' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWorkoutDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WorkoutView> {
    if (!key || key.toLowerCase() !== dto.clientId.toLowerCase()) {
      throw AppException.validation([{ field: 'Idempotency-Key', code: 'MUST_EQUAL_CLIENT_ID' }]);
    }
    const result = await this.workouts.create(user.id, dto);
    if (result.workout.status === 'REJECTED') throw rejected(result.workout);
    res.status(result.kind === 'CREATED' ? HttpStatus.CREATED : HttpStatus.OK).setHeader('ETag', `"${result.workout.version}"`);
    return result.workout;
  }

  /** Offline outbox flush (docs §10): each item gets its own result; one bad item does not fail the batch. */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'workouts-sync', limit: 10, windowS: 3600, by: 'user' })
  async sync(@CurrentUser() user: AuthUser, @Body() dto: SyncWorkoutsDto) {
    const results = [];
    for (const item of dto.items) {
      try {
        const r: CreateResult = await this.workouts.create(user.id, item);
        results.push({ clientId: item.clientId, result: r.workout.status === 'REJECTED' ? 'REJECTED' : r.kind, workout: r.workout });
      } catch (err) {
        if (!(err instanceof AppException)) throw err;
        results.push({ clientId: item.clientId, result: err.code === ErrorCode.IDEMPOTENCY_CONFLICT ? 'CONFLICT' : 'INVALID', error: { code: err.code, errors: err.options.errors, ...err.options.extra } });
      }
    }
    return { results };
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListWorkoutsQueryDto) {
    return this.workouts.list(user.id, q);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const w = await this.workouts.get(user.id, id);
    res.setHeader('ETag', `"${w.version}"`);
    return w;
  }

  @Patch(':id')
  @ApiHeader({ name: 'If-Match', required: true, description: 'The workout version (ETag) being edited.' })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WorkoutContentDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const w = await this.workouts.update(user.id, id, dto, ifMatch);
    res.setHeader('ETag', `"${w.version}"`);
    return w;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.workouts.remove(user.id, id);
  }
}

/** Held-workout queue (docs §12.2 assumption: Phase 1 needs someone to resolve HELD_FOR_REVIEW). */
@ApiTags('admin')
@ApiBearerAuth()
@AdminApi()
@Roles('MODERATOR', 'ADMIN', 'SUPER_ADMIN')
@Controller('admin/workouts')
export class HeldWorkoutsController {
  constructor(private readonly workouts: WorkoutsService) {}

  @Get('held')
  held(@Query() q: PageQueryDto) {
    return this.workouts.listHeld(q.limit, q.cursor);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.workouts.review(user.id, id, 'APPROVE', dto.note);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.workouts.review(user.id, id, 'REJECT', dto.note);
  }
}
