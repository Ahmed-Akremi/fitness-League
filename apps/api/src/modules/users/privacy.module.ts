import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrivacyService } from './privacy.service';

@Module({ imports: [AuthModule], providers: [PrivacyService], exports: [PrivacyService] })
export class PrivacyModule {}
