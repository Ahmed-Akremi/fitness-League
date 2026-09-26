import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, Locale } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

// 10–128 chars (docs §9.1). Composition rules are deliberately absent (NIST 800-63B): length is what matters.
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128;

export class ConsentsDto {
  @ApiProperty({ description: 'Terms of use — must be accepted.' })
  @Equals(true)
  terms!: boolean;

  @ApiProperty({ description: 'Privacy policy — must be accepted.' })
  @Equals(true)
  privacy!: boolean;

  @ApiProperty({ description: 'Processing of health data (body weight, measurements). Optional; without it those features stay off.' })
  @IsBoolean()
  healthData!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  marketing?: boolean;

  @ApiProperty({ example: '2026-09' })
  @IsString()
  @Length(1, 20)
  documentVersion!: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'ahmed_fit', description: '3–20 chars: lowercase letters, digits, `_` and `.`' })
  @Matches(/^[a-z0-9_.]{3,20}$/)
  username!: string;

  @ApiProperty({ example: 'Ahmed Ben Salah' })
  @IsString()
  @Length(2, 80)
  fullName!: string;

  @ApiProperty({ example: 'ahmed@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password!: string;

  @ApiProperty({ example: '1998-04-12', description: 'Never shown publicly.' })
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateOfBirth!: string;

  @ApiProperty({ example: 'TN' })
  @Matches(/^[A-Z]{2}$/)
  countryCode!: string;

  @ApiProperty()
  @IsUUID()
  governorateId!: string;

  @ApiProperty()
  @IsUUID()
  cityId!: string;

  @ApiPropertyOptional({ example: '+21620123456' })
  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/)
  phone?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ enum: Locale })
  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;

  @ApiProperty({ type: ConsentsDto })
  @ValidateNested()
  @Type(() => ConsentsDto)
  consents!: ConsentsDto;
}

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @Length(20, 200)
  refreshToken!: string;
}

export class TokenDto {
  @ApiProperty()
  @IsString()
  @Length(20, 200)
  token!: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @Length(20, 200)
  token!: string;

  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  newPassword!: string;
}

export class SessionDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ description: 'Seconds until the access token expires.' }) expiresIn!: number;
  @ApiProperty({ description: 'Opaque, single use: every refresh returns a new one.' }) refreshToken!: string;
  @ApiProperty() userId!: string;
}

/** Fields a first OAuth sign-in must provide (the ID token only gives email and, sometimes, a name). */
export class OAuthRegistrationDto {
  @ApiProperty({ example: 'ahmed_fit' })
  @Matches(/^[a-z0-9_.]{3,20}$/)
  username!: string;

  @ApiPropertyOptional({ description: 'Required when the provider does not share a name (Apple after the first sign-in).' })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  fullName?: string;

  @ApiProperty({ example: '1998-04-12' })
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateOfBirth!: string;

  @ApiProperty({ example: 'TN' })
  @Matches(/^[A-Z]{2}$/)
  countryCode!: string;

  @ApiProperty()
  @IsUUID()
  governorateId!: string;

  @ApiProperty()
  @IsUUID()
  cityId!: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ enum: Locale })
  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;

  @ApiProperty({ type: ConsentsDto })
  @ValidateNested()
  @Type(() => ConsentsDto)
  consents!: ConsentsDto;
}

export class OAuthSignInDto {
  @ApiProperty({ description: 'ID token obtained natively from Google or Apple.' })
  @IsString()
  @Length(20, 8192)
  idToken!: string;

  @ApiPropertyOptional({ description: 'Nonce sent to the provider, checked against the token.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  nonce?: string;

  @ApiPropertyOptional({ type: OAuthRegistrationDto, description: 'Only on first sign-in, after an OAUTH_REGISTRATION_REQUIRED answer.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => OAuthRegistrationDto)
  registration?: OAuthRegistrationDto;
}

export class DeleteAccountDto {
  @ApiPropertyOptional({ description: 'Current password (required when the account has one).' })
  @IsOptional()
  @IsString()
  @MaxLength(PASSWORD_MAX)
  password?: string;

  @ApiProperty({ description: 'Must be the literal string DELETE.' })
  @Equals('DELETE')
  confirm!: string;
}
