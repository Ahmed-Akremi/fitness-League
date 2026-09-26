import { Injectable } from '@nestjs/common';

/** Injected everywhere "now" matters, so weeks, seasons and battles are testable with a fake clock. */
@Injectable()
export class ClockService {
  now(): Date {
    return new Date();
  }
}
