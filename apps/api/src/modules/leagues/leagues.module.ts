import { Module } from '@nestjs/common';
import { LeaguesController } from './leagues.controller';
import { LeaguesService } from './leagues.service';

@Module({ controllers: [LeaguesController], providers: [LeaguesService] })
export class LeaguesModule {}
