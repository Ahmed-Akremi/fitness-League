import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { SeasonsModule } from '../seasons/seasons.module';
import { BattlesController } from './battles.controller';
import { BattlesService } from './battles.service';

@Module({ imports: [LedgerModule, SeasonsModule], controllers: [BattlesController], providers: [BattlesService], exports: [BattlesService] })
export class BattlesModule {}
