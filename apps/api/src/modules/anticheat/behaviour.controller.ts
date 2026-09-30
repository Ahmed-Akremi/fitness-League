import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, Length } from 'class-validator';
import type { AuthUser } from '../../common/auth/auth-user';
import { AdminApi, CurrentUser, Roles } from '../../common/auth/decorators';
import { BehaviourService } from './behaviour.service';

export class ReviewFlagDto {
  @ApiProperty({ enum: ['CLEARED', 'CONFIRMED'] })
  @IsIn(['CLEARED', 'CONFIRMED'])
  status!: 'CLEARED' | 'CONFIRMED';

  @ApiProperty()
  @IsString()
  @Length(3, 500)
  note!: string;
}

/** Behavioural flags for moderators (docs §7.3). Confirming one does not sanction: use a report decision for that. */
@ApiTags('admin')
@ApiBearerAuth()
@AdminApi()
@Roles('MODERATOR', 'ADMIN', 'SUPER_ADMIN')
@Controller('admin/anticheat/flags')
export class BehaviourController {
  constructor(private readonly behaviour: BehaviourService) {}

  @Get()
  list() {
    return this.behaviour.openFlags();
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  review(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewFlagDto) {
    return this.behaviour.review(actor, id, dto.status, dto.note);
  }
}
