import { Module } from '@nestjs/common';
import { AppModule } from './app.module';

/** The worker reuses every domain module (and their event handlers); it just never listens for HTTP. */
@Module({ imports: [AppModule] })
export class WorkerModule {}
