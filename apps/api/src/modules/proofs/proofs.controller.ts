import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ProofKind } from '@prisma/client';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import type { AuthUser } from '../../common/auth/auth-user';
import { AdminApi, CurrentUser, Roles } from '../../common/auth/decorators';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { PROOF_MAX_BYTES, ProofsService } from './proofs.service';

export class ProofKindQuery {
  @ApiPropertyOptional({ enum: ['PHOTO', 'SCREENSHOT'], default: 'PHOTO' })
  @IsOptional()
  @IsIn(['PHOTO', 'SCREENSHOT'])
  kind?: ProofKind;
}

export class ProofDecisionDto {
  @ApiProperty({ enum: ['VERIFY', 'REJECT'] })
  @IsIn(['VERIFY', 'REJECT'])
  decision!: 'VERIFY' | 'REJECT';

  @ApiPropertyOptional({ description: 'Required when rejecting; shown to the athlete' })
  @IsOptional()
  @IsString()
  @Length(0, 300)
  note?: string;
}

/** Proofs attached by the athlete (docs §4.5 P3 `/workouts/{id}/proofs`). */
@ApiTags('proofs')
@ApiBearerAuth()
@Controller('workouts/:id/proofs')
export class ProofsController {
  constructor(private readonly proofs: ProofsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.proofs.list(user, id);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PROOF_MAX_BYTES + 1, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @RateLimit({ name: 'proof-upload', limit: 30, windowS: 86_400, by: 'user' })
  add(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: ProofKindQuery, @UploadedFile() file?: Express.Multer.File) {
    return this.proofs.add(user, id, q.kind ?? 'PHOTO', file);
  }

  @Delete(':proofId')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('proofId', ParseUUIDPipe) proofId: string) {
    return this.proofs.remove(user, id, proofId);
  }
}

/** Moderators review proofs (docs §4.5 P3 moderation queue). */
@ApiTags('admin')
@ApiBearerAuth()
@AdminApi()
@Roles('MODERATOR', 'ADMIN', 'SUPER_ADMIN')
@Controller('admin/proofs')
export class AdminProofsController {
  constructor(private readonly proofs: ProofsService) {}

  @Get('queue')
  queue() {
    return this.proofs.queue();
  }

  @Post(':workoutId/decide')
  @HttpCode(HttpStatus.OK)
  decide(@CurrentUser() actor: AuthUser, @Param('workoutId', ParseUUIDPipe) workoutId: string, @Body() dto: ProofDecisionDto) {
    return this.proofs.decide(actor, workoutId, dto.decision, dto.note);
  }
}
