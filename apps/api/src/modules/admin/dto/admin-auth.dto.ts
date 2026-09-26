import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class AdminLoginDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ description: '6-digit code from the authenticator app (required once 2FA is set up).' })
  @IsOptional()
  @Matches(/^\d{6}$/)
  code?: string;
}

export class TotpConfirmDto {
  @ApiProperty()
  @IsString()
  @Length(20, 2000)
  setupToken!: string;

  @ApiProperty()
  @Matches(/^\d{6}$/)
  code!: string;
}
