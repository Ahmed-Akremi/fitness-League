import { Module } from '@nestjs/common';
import { GymsModule } from '../gyms/gyms.module';
import { GymWodsController } from './gym-wods.controller';
import { GymWodsService } from './gym-wods.service';

@Module({ imports: [GymsModule], controllers: [GymWodsController], providers: [GymWodsService] })
export class GymWodsModule {}
