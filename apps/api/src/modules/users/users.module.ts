import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrivacyModule } from './privacy.module';
import { OnboardingService } from './onboarding.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, PrivacyModule],
  controllers: [UsersController],
  providers: [UsersService, OnboardingService],
  exports: [UsersService],
})
export class UsersModule {}
