import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequiresVerifiedEmail } from '../../common/auth/decorators';
import { PageQueryDto } from '../../common/pagination/page';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { SocialService } from './social.service';

class FriendRequestDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;
}

class RequestsQueryDto {
  @ApiPropertyOptional({ enum: ['in', 'out'], default: 'in' })
  @IsOptional()
  @IsIn(['in', 'out'])
  direction: 'in' | 'out' = 'in';
}

class SearchQueryDto extends PageQueryDto {
  @ApiProperty({ minLength: 2 })
  @IsString()
  @Length(2, 40)
  q!: string;
}

@ApiTags('social')
@ApiBearerAuth()
@Controller()
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('friends')
  friends(@CurrentUser() user: AuthUser) {
    return this.social.friends(user.id);
  }

  @Get('friends/requests')
  requests(@CurrentUser() user: AuthUser, @Query() q: RequestsQueryDto) {
    return this.social.requests(user.id, q.direction);
  }

  @Post('friends/requests')
  @RequiresVerifiedEmail()
  @RateLimit({ name: 'friend-requests', limit: 30, windowS: 86_400, by: 'user' })
  request(@CurrentUser() user: AuthUser, @Body() dto: FriendRequestDto) {
    return this.social.request(user.id, dto.userId);
  }

  @Post('friends/requests/:userId/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.social.respond(user.id, userId, true);
  }

  @Post('friends/requests/:userId/decline')
  @HttpCode(HttpStatus.OK)
  decline(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.social.respond(user.id, userId, false);
  }

  @Delete('friends/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  unfriend(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.social.unfriend(user.id, userId);
  }

  @Post('follows/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  follow(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.social.follow(user.id, userId);
  }

  @Delete('follows/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  unfollow(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.social.unfollow(user.id, userId);
  }

  @Post('blocks/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  block(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.social.block(user.id, userId);
  }

  @Delete('blocks/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  unblock(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.social.unblock(user.id, userId);
  }

  @Get('search/athletes')
  @RateLimit({ name: 'search', limit: 60, windowS: 60, by: 'user' })
  search(@CurrentUser() user: AuthUser, @Query() q: SearchQueryDto) {
    return this.social.search(user.id, q.q, q);
  }

  @Get('users/:username')
  profile(@CurrentUser() user: AuthUser, @Param('username') username: string) {
    return this.social.publicProfile(user.id, username);
  }
}
