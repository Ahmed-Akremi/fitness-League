import { Module } from '@nestjs/common';
import { PrivacyModule } from '../users/privacy.module';
import { HeldWorkoutsController, WorkoutsController } from './workouts.controller';
import { WorkoutsService } from './workouts.service';

@Module({
  imports: [PrivacyModule],
  controllers: [WorkoutsController, HeldWorkoutsController],
  providers: [WorkoutsService],
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
