import { Module } from '@nestjs/common';
import { BadgesModule } from '../badges/badges.module';
import { GymsModule } from '../gyms/gyms.module';
import { LedgerModule } from '../ledger/ledger.module';
import { SeasonsModule } from '../seasons/seasons.module';
import { GymWarsController } from './gym-wars.controller';
import { GymWarsService } from './gym-wars.service';

@Module({ imports: [BadgesModule, GymsModule, LedgerModule, SeasonsModule], controllers: [GymWarsController], providers: [GymWarsService], exports: [GymWarsService] })
export class GymWarsModule {}
