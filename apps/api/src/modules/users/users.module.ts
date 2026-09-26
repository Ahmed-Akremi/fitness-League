import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ScoringModule } from '../scoring/scoring.module';
import { OnboardingService } from './onboarding.service';
import { PrivacyService } from './privacy.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [ScoringModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService, OnboardingService, PrivacyService],
  exports: [UsersService, PrivacyService],
})
export class UsersModule {}
