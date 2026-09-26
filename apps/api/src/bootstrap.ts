import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ENV } from './common/config/config.module';
import type { Env } from './common/config/env.schema';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter';
import { createValidationPipe } from './common/errors/validation';

export const API_PREFIX = 'api/v1';

/** Shared by main.ts, the OpenAPI export script and integration tests, so they all run the same pipeline. */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: false });
  app.useBodyParser('json', { limit: '256kb' });
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();
  return app;
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const env = app.get<Env>(ENV);
  const config = new DocumentBuilder()
    .setTitle(`${env.APP_NAME} API`)
    .setVersion('1')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}
