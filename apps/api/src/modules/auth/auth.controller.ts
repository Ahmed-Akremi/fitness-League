import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public } from '../../common/auth/decorators';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { AuthService, RequestContext } from './auth.service';
import { ForgotPasswordDto, LoginDto, OAuthSignInDto, RefreshDto, RegisterDto, ResetPasswordDto, SessionDto, TokenDto } from './dto/auth.dto';

const ctx = (req: Request & { id?: unknown }): RequestContext => ({ requestId: req.id !== undefined ? String(req.id) : undefined });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @RateLimit({ name: 'register', limit: 5, windowS: 3600, by: 'ip' })
  @ApiCreatedResponse({ type: SessionDto })
  register(@Body() dto: RegisterDto, @Req() req: Request): Promise<SessionDto> {
    return this.auth.register(dto, ctx(req));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'login-ip', limit: 10, windowS: 60, by: 'ip' }, { name: 'login-account', limit: 5, windowS: 900, by: 'body.email' })
  @ApiOkResponse({ type: SessionDto })
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<SessionDto> {
    return this.auth.login(dto, ctx(req));
  }

  @Public()
  @Post('oauth/google')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'oauth', limit: 20, windowS: 60, by: 'ip' })
  @ApiOkResponse({ type: SessionDto, description: '422 OAUTH_REGISTRATION_REQUIRED on first sign-in without `registration`.' })
  google(@Body() dto: OAuthSignInDto, @Req() req: Request): Promise<SessionDto> {
    return this.auth.oauthSignIn('GOOGLE', dto, ctx(req));
  }

  @Public()
  @Post('oauth/apple')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'oauth', limit: 20, windowS: 60, by: 'ip' })
  @ApiOkResponse({ type: SessionDto, description: '422 OAUTH_REGISTRATION_REQUIRED on first sign-in without `registration`.' })
  apple(@Body() dto: OAuthSignInDto, @Req() req: Request): Promise<SessionDto> {
    return this.auth.oauthSignIn('APPLE', dto, ctx(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'refresh', limit: 30, windowS: 60, by: 'ip' })
  @ApiOkResponse({ type: SessionDto })
  refresh(@Body() dto: RefreshDto, @Req() req: Request): Promise<SessionDto> {
    return this.auth.refresh(dto.refreshToken, ctx(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiNoContentResponse()
  logout(@CurrentUser() user: AuthUser, @Body() dto: RefreshDto): Promise<void> {
    return this.auth.logout(user.id, dto.refreshToken);
  }

  @Public()
  @Post('email/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ name: 'email-verify', limit: 20, windowS: 3600, by: 'ip' })
  @ApiNoContentResponse()
  verifyEmail(@Body() dto: TokenDto): Promise<void> {
    return this.auth.verifyEmail(dto.token);
  }

  @Post('email/resend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @RateLimit({ name: 'email-resend', limit: 3, windowS: 3600, by: 'user' })
  @ApiNoContentResponse()
  resendVerification(@CurrentUser() user: AuthUser): Promise<void> {
    return this.auth.resendVerification(user.id);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ name: 'forgot-ip', limit: 10, windowS: 3600, by: 'ip' }, { name: 'forgot-account', limit: 3, windowS: 3600, by: 'body.email' })
  @ApiAcceptedResponse({ description: 'Always 202, whether or not the email exists.' })
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    return this.auth.forgotPassword(dto);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ name: 'reset', limit: 10, windowS: 3600, by: 'ip' })
  @ApiNoContentResponse()
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request): Promise<void> {
    return this.auth.resetPassword(dto, ctx(req));
  }
}
