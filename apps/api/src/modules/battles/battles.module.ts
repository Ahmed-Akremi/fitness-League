import { Module } from '@nestjs/common';
import { DuelsModule } from '../duels/duels.module';
import { LedgerModule } from '../ledger/ledger.module';
import { SeasonsModule } from '../seasons/seasons.module';
import { BattlesController } from './battles.controller';
import { BadgesModule } from '../badges/badges.module';
import { BattlesService } from './battles.service';

@Module({ imports: [LedgerModule, SeasonsModule, DuelsModule, BadgesModule], controllers: [BattlesController], providers: [BattlesService], exports: [BattlesService] })
export class BattlesModule {}
