import { Global, Module } from '@nestjs/common';
import { ExpectedProgressionService } from './expected-progression.service';
import { RuleSetService } from './rule-set.service';

/** Read access to the active rule set, used across modules; no dependencies, so it can never cause a cycle. */
@Global()
@Module({ providers: [RuleSetService, ExpectedProgressionService], exports: [RuleSetService, ExpectedProgressionService] })
export class RuleSetModule {}
