import './load-env';
import { SwaggerModule } from '@nestjs/swagger';
import { buildOpenApi, createApp } from './bootstrap';
import { ENV } from './common/config/config.module';
import type { Env } from './common/config/env.schema';

async function main(): Promise<void> {
  const app = await createApp();
  const env = app.get<Env>(ENV);
  if (env.OPENAPI_ENABLED) {
    SwaggerModule.setup('api/docs', app, buildOpenApi(app));
  }
  await app.listen(env.PORT);
}

void main();
