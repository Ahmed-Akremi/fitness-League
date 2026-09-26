import { Global, Module } from '@nestjs/common';
import { BusinessCalendar } from './clock/business-calendar';
import { ClockService } from './clock/clock.service';
import { ENV } from './config/config.module';
import type { Env } from './config/env.schema';
import { HealthController } from './health/health.controller';
import { CursorCodec } from './pagination/cursor';
import { HealthDataCipher } from './crypto/health-data-cipher';

@Global()
@Module({
  controllers: [HealthController],
  providers: [
    ClockService,
    { provide: CursorCodec, inject: [ENV], useFactory: (env: Env) => new CursorCodec(env.CURSOR_HMAC_SECRET) },
    { provide: HealthDataCipher, inject: [ENV], useFactory: (env: Env) => new HealthDataCipher(env.HEALTH_DATA_KEYS) },
    { provide: BusinessCalendar, inject: [ENV], useFactory: (env: Env) => new BusinessCalendar(env.BUSINESS_UTC_OFFSET_MINUTES) },
  ],
  exports: [ClockService, CursorCodec, BusinessCalendar, HealthDataCipher],
})
export class CommonModule {}
