import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { AdminApi, CurrentUser, RequiresVerifiedEmail, Roles } from '../../common/auth/decorators';
import { PageQueryDto } from '../../common/pagination/page';
import { CreateGymDto, ListGymsQueryDto, ReviewGymDto, UpdateGymDto } from './dto/gym.dto';
import { GymLogoService, LOGO_MAX_BYTES } from './gym-logo.service';
import { GymsService } from './gyms.service';

@ApiTags('gyms')
@ApiBearerAuth()
@Controller('gyms')
export class GymsController {
  constructor(
    private readonly gyms: GymsService,
    private readonly logos: GymLogoService,
  ) {}

  @Get()
  list(@Query() q: ListGymsQueryDto) {
    return this.gyms.list(q);
  }

  @Post()
  @RequiresVerifiedEmail()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateGymDto) {
    return this.gyms.create(user, dto);
  }

  @Get('me/membership')
  myMembership(@CurrentUser() user: AuthUser) {
    return this.gyms.myMembership(user.id);
  }

  @Delete('me/membership')
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(@CurrentUser() user: AuthUser): Promise<void> {
    return this.gyms.leave(user.id);
  }

  @Put(':id/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES + 1, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  setLogo(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.logos.set(user, id, file);
  }

  @Delete(':id/logo')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeLogo(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.logos.remove(user, id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.gyms.get(id, user);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGymDto) {
    return this.gyms.update(user, id, dto);
  }

  @Post(':id/membership')
  join(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.gyms.requestMembership(user.id, id);
  }

  @Get(':id/members')
  members(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageQueryDto) {
    return this.gyms.members(id, q);
  }

  @Get(':id/membership-requests')
  requests(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.gyms.membershipRequests(user, id);
  }

  @Post(':id/members/:userId/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.gyms.decide(user, id, userId, 'approve');
  }

  @Post(':id/members/:userId/reject')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.gyms.decide(user, id, userId, 'reject');
  }

  @Post(':id/members/:userId/remove')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.gyms.decide(user, id, userId, 'remove');
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@AdminApi()
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('admin/gyms/verification-requests')
export class GymVerificationController {
  constructor(private readonly gyms: GymsService) {}

  @Get()
  queue(@Query() q: PageQueryDto) {
    return this.gyms.verificationQueue(q);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewGymDto) {
    return this.gyms.review(user, id, dto);
  }
}
