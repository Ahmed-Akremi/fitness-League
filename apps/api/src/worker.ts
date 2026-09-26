import './load-env';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

/**
 * Background worker entrypoint (BullMQ jobs, outbox drain — docs §8).
 * Same codebase as the API, separate process, so jobs never run inside request handlers.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('Worker started (no jobs registered yet — they arrive with their modules).');
}

void main();
