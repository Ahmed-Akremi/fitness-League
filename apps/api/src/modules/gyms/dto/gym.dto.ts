import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsObject, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

export class CreateGymDto {
  @ApiProperty({ example: 'Sahel Iron Club' })
  @IsString()
  @Length(3, 80)
  name!: string;

  @ApiProperty()
  @IsUUID()
  governorateId!: string;

  @ApiProperty()
  @IsUUID()
  cityId!: string;

  @ApiPropertyOptional({ description: 'Street address (city-level location is what the app shows).' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine?: string;

  @ApiPropertyOptional({ example: '+21673000000' })
  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/)
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional({ example: { instagram: 'https://instagram.com/sahel.iron' } })
  @IsOptional()
  @IsObject()
  socialLinks?: Record<string, string>;

  @ApiProperty({ description: 'How the owner can prove ownership (e.g. business registration number, website).' })
  @IsString()
  @Length(10, 1000)
  proofOfOwnership!: string;
}

export class UpdateGymDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/)
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  socialLinks?: Record<string, string>;
}

export class ListGymsQueryDto extends PageQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  governorateId?: string;

  @ApiPropertyOptional({ description: 'Name search' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class ReviewGymDto {
  @ApiProperty()
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export const SOCIAL_LINK_KEYS = ['instagram', 'facebook', 'website', 'tiktok'] as const;
export const isHttpUrl = (v: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};
