import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { DeleteAccountDto } from '../auth/dto/auth.dto';
import { BodyMeasurementDto, ConsentUpdateDto, OnboardingBaselinesDto, OnboardingSportsDto } from './dto/onboarding.dto';
import { UpdateProfileDto, UpdateSettingsDto } from './dto/users.dto';
import { OnboardingService } from './onboarding.service';
import { PrivacyService } from './privacy.service';
import { UsersService } from './users.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly onboarding: OnboardingService,
    private readonly privacy: PrivacyService,
  ) {}

  @Get()
  @ApiOkResponse()
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.id);
  }

  @Patch('profile')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: AuthUser, @Body() dto: UpdateSettingsDto) {
    return this.users.updateSettings(user.id, dto);
  }

  // ─────────── Onboarding ───────────

  @Get('onboarding')
  onboardingState(@CurrentUser() user: AuthUser) {
    return this.onboarding.state(user.id);
  }

  @Post('onboarding/sports')
  @HttpCode(HttpStatus.OK)
  onboardingSports(@CurrentUser() user: AuthUser, @Body() dto: OnboardingSportsDto) {
    return this.onboarding.setSports(user.id, dto);
  }

  @Post('onboarding/baselines')
  @HttpCode(HttpStatus.OK)
  onboardingBaselines(@CurrentUser() user: AuthUser, @Body() dto: OnboardingBaselinesDto) {
    return this.onboarding.declareBaselines(user.id, dto);
  }

  @Post('onboarding/complete')
  @HttpCode(HttpStatus.OK)
  onboardingComplete(@CurrentUser() user: AuthUser) {
    return this.onboarding.complete(user.id);
  }

  // ─────────── Privacy ───────────

  @Get('consents')
  consents(@CurrentUser() user: AuthUser) {
    return this.privacy.consents(user.id);
  }

  @Post('consents')
  updateConsent(@CurrentUser() user: AuthUser, @Body() dto: ConsentUpdateDto) {
    return this.privacy.updateConsent(user.id, dto);
  }

  @Get('body-measurements')
  bodyMeasurements(@CurrentUser() user: AuthUser) {
    return this.privacy.bodyMeasurements(user.id);
  }

  @Post('body-measurements')
  addBodyMeasurement(@CurrentUser() user: AuthUser, @Body() dto: BodyMeasurementDto) {
    return this.privacy.addBodyMeasurement(user.id, dto);
  }

  @Get('export')
  @RateLimit({ name: 'export', limit: 3, windowS: 86_400, by: 'user' })
  export(@CurrentUser() user: AuthUser) {
    return this.privacy.export(user.id);
  }

  @Delete()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: 'Deletion scheduled after a 30-day grace period; signing in again cancels it.' })
  deleteAccount(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto) {
    return this.privacy.requestDeletion(user.id, dto);
  }
}
