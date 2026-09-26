import './load-env';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { OutboxDispatcher } from './common/outbox/outbox-dispatcher';
import { WorkerModule } from './worker.module';

const OUTBOX_POLL_MS = 1000;

/**
 * Background worker (docs §8): drains the domain-event outbox and runs scheduled jobs.
 * Same codebase as the API, separate process, so this work never runs inside request handlers.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  const outbox = app.get(OutboxDispatcher);
  let stopping = false;
  const tick = async () => {
    if (stopping) return;
    try {
      await outbox.drainAll();
    } catch (err) {
      logger.error({ err }, 'Outbox drain failed');
    }
    setTimeout(() => void tick(), OUTBOX_POLL_MS);
  };
  process.on('SIGTERM', () => (stopping = true));
  process.on('SIGINT', () => (stopping = true));
  void tick();
  logger.log('Worker started: outbox dispatcher running');
}

void main();
