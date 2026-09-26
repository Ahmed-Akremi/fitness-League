import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class ReviewDto {
  @ApiProperty({ description: 'Reason, visible to the athlete and kept in the audit log.' })
  @IsString()
  @Length(3, 500)
  note!: string;
}
