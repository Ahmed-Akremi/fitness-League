import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import type { AuthUser } from '../../common/auth/auth-user';
import { AdminApi, CurrentUser, Roles } from '../../common/auth/decorators';
import { PageQueryDto } from '../../common/pagination/page';
import { ANNOUNCEMENT_IMAGE_MAX_BYTES } from './announcement-rules';
import { AnnouncementsService } from './announcements.service';

export class PublishAnnouncementDto {
  /** Up to 2000 characters once trimmed (checked by the service); optional when a photo is attached. */
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() body?: string;
}

/** App side: read the news and like it. There is deliberately no comment route. */
@ApiTags('announcements')
@ApiBearerAuth()
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
    return this.announcements.feed(user.id, q);
  }

  @Put(':id/like')
  like(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.like(user.id, id);
  }

  @Delete(':id/like')
  unlike(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.unlike(user.id, id);
  }
}

/** Admin panel → Publications: platform admins publish text and/or one photo (never video). */
@ApiTags('admin')
@ApiBearerAuth()
@AdminApi()
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('admin/announcements')
export class AdminAnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ANNOUNCEMENT_IMAGE_MAX_BYTES + 1, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  publish(@CurrentUser() user: AuthUser, @Body() dto: PublishAnnouncementDto, @UploadedFile() file?: Express.Multer.File) {
    return this.announcements.publish(user, dto.body, file);
  }

  @Get()
  list(@Query() q: PageQueryDto) {
    return this.announcements.adminList(q);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.remove(user, id);
  }
}
