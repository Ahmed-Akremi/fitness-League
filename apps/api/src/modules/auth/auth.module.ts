import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit';
import { ScoringModule } from '../scoring/scoring.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { OAuthVerifier } from './oauth-verifier';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Module({
  imports: [ScoringModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    OAuthVerifier,
    PasswordService,
    TokenService,
    // Order matters: authenticate first so per-user rate limits know who is calling.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [TokenService, PasswordService, OAuthVerifier],
})
export class AuthModule {}
