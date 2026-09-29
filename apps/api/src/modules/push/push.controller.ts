import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Platform } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { PushService } from './push.service';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'Stable id of this app install' })
  @IsString()
  @Length(8, 128)
  installId!: string;

  @ApiProperty({ enum: ['ANDROID', 'IOS', 'WEB'] })
  @IsIn(['ANDROID', 'IOS', 'WEB'])
  platform!: Platform;

  @ApiPropertyOptional({ description: 'FCM registration token; null stops pushes to this install' })
  @IsOptional()
  @IsString()
  @Length(20, 4096)
  fcmToken?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 32)
  appVersion?: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class QuietHoursDto {
  @ApiProperty({ example: '22:00' })
  @Matches(HHMM)
  start!: string;

  @ApiProperty({ example: '07:00' })
  @Matches(HHMM)
  end!: string;
}

export class PushCategoriesDto {
  @IsOptional() @IsBoolean() SOCIAL?: boolean;
  @IsOptional() @IsBoolean() BATTLES?: boolean;
  @IsOptional() @IsBoolean() COMPETITION?: boolean;
  @IsOptional() @IsBoolean() CHALLENGES?: boolean;
  @IsOptional() @IsBoolean() BADGES?: boolean;
  @IsOptional() @IsBoolean() GYM?: boolean;
}

export class NotificationPreferencesDto {
  @ApiPropertyOptional({ description: 'Per-category push switches (SOCIAL, BATTLES, COMPETITION, CHALLENGES, BADGES, GYM)' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PushCategoriesDto)
  categories?: PushCategoriesDto;

  @ApiPropertyOptional({ type: QuietHoursDto, nullable: true, description: 'Local time (Africa/Tunis); null removes them' })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuietHoursDto)
  quietHours?: QuietHoursDto | null;
}

/** Devices (FCM tokens) and push preferences (docs §4.5). */
@ApiTags('push')
@ApiBearerAuth()
@Controller('me')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Put('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  register(@CurrentUser() user: AuthUser, @Body() dto: RegisterDeviceDto): Promise<void> {
    return this.push.registerDevice(user.id, dto);
  }

  @Delete('devices/:installId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('installId') installId: string): Promise<void> {
    return this.push.removeDevice(user.id, installId);
  }

  @Get('notification-preferences')
  preferences(@CurrentUser() user: AuthUser) {
    return this.push.preferences(user.id);
  }

  @Put('notification-preferences')
  setPreferences(@CurrentUser() user: AuthUser, @Body() dto: NotificationPreferencesDto) {
    return this.push.setPreferences(user.id, { categories: dto.categories as Record<string, boolean> | undefined, quietHours: dto.quietHours });
  }
}
