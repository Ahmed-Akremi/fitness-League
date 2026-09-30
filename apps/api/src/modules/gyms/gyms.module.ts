import { Module } from '@nestjs/common';
import { GymsController, GymVerificationController } from './gyms.controller';
import { GymDashboardService } from './gym-dashboard.service';
import { GymLogoService } from './gym-logo.service';
import { GymsService } from './gyms.service';

@Module({ controllers: [GymsController, GymVerificationController], providers: [GymsService, GymLogoService, GymDashboardService], exports: [GymsService] })
export class GymsModule {}
