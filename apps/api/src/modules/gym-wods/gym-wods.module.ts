import { Module } from '@nestjs/common';
import { GymsModule } from '../gyms/gyms.module';
import { NotificationsModule } from '../notifications/notifications.service';
import { WorkoutsModule } from '../workouts/workouts.module';
import { GymWodsController } from './gym-wods.controller';
import { GymWodsService } from './gym-wods.service';

@Module({ imports: [GymsModule, WorkoutsModule, NotificationsModule], controllers: [GymWodsController], providers: [GymWodsService] })
export class GymWodsModule {}
