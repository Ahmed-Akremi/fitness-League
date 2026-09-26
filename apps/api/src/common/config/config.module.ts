import { Global, Module } from '@nestjs/common';
import { Env, loadEnv } from './env.schema';

export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
