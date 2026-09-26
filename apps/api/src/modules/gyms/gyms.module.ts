import { Module } from '@nestjs/common';
import { GymsController, GymVerificationController } from './gyms.controller';
import { GymsService } from './gyms.service';

@Module({ controllers: [GymsController, GymVerificationController], providers: [GymsService], exports: [GymsService] })
export class GymsModule {}
