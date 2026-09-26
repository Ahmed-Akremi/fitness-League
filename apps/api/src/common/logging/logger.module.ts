import { Module } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';
import { uuidv7 } from '../ids/uuid';

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Structured JSON logs with a request id; personal and health data are redacted (docs §9.6). */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          genReqId: (req: IncomingMessage) => {
            const given = req.headers['x-request-id'];
            return typeof given === 'string' && REQUEST_ID.test(given) ? given : uuidv7();
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.email',
              'req.body.phone',
              'req.body.dateOfBirth',
              'req.body.weightKg',
              'req.body.refreshToken',
            ],
            censor: '[redacted]',
          },
          transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
          autoLogging: env.NODE_ENV !== 'test',
        },
      }),
    }),
  ],
})
export class LoggerModule {}
