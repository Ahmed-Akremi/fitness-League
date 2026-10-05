import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ReactionType } from '@prisma/client';
import { IsIn, IsString, Length } from 'class-validator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequiresVerifiedEmail } from '../../common/auth/decorators';
import { PageQueryDto } from '../../common/pagination/page';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { FeedService } from './feed.service';

export class ReactDto {
  @ApiProperty({ enum: ['LIKE', 'FIRE', 'STRONG'] })
  @IsIn(['LIKE', 'FIRE', 'STRONG'])
  type!: ReactionType;
}

export class CommentDto {
  @ApiProperty({ example: 'Beast mode 💪' })
  @IsString()
  @Length(1, 500)
  body!: string;
}

/** Activity feed, reactions, comments and mutes (docs §4.5). */
@ApiTags('feed')
@ApiBearerAuth()
@Controller()
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get('feed')
  list(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
    return this.feed.feed(user.id, q);
  }

  @Put('activities/:id/reactions')
  react(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReactDto) {
    return this.feed.react(user.id, id, dto.type);
  }

  @Delete('activities/:id/reactions')
  unreact(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.feed.unreact(user.id, id);
  }

  @Get('activities/:id/comments')
  comments(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: PageQueryDto) {
    return this.feed.comments(user.id, id, q);
  }

  @Post('activities/:id/comments')
  @RequiresVerifiedEmail()
  @RateLimit({ name: 'comment', limit: 30, windowS: 3_600, by: 'user' })
  comment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentDto) {
    return this.feed.comment(user.id, id, dto.body);
  }

  @Delete('activities/:id/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteComment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('commentId', ParseUUIDPipe) commentId: string): Promise<void> {
    return this.feed.deleteComment(user.id, id, commentId);
  }

  @Put('me/mutes/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  mute(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.feed.mute(user.id, userId);
  }

  @Delete('me/mutes/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  unmute(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.feed.unmute(user.id, userId);
  }
}
