import { Module } from '@nestjs/common';
import { DuelsController } from './duels.controller';
import { DuelsService } from './duels.service';

@Module({ controllers: [DuelsController], providers: [DuelsService], exports: [DuelsService] })
export class DuelsModule {}
