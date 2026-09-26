import { Module } from '@nestjs/common';
import { RuleSetService } from './rule-set.service';

@Module({ providers: [RuleSetService], exports: [RuleSetService] })
export class ScoringModule {}
