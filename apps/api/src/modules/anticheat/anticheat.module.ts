import { Module } from '@nestjs/common';
import { BehaviourController } from './behaviour.controller';
import { BehaviourService } from './behaviour.service';

@Module({ controllers: [BehaviourController], providers: [BehaviourService], exports: [BehaviourService] })
export class AnticheatModule {}
