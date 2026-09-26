import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LedgerModule } from '../ledger/ledger.module';
import { SeasonsModule } from '../seasons/seasons.module';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController, AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({ imports: [AuthModule, LedgerModule, SeasonsModule], controllers: [AdminAuthController, AdminController], providers: [AdminAuthService, AdminService] })
export class AdminModule {}
