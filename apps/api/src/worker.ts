import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WorkerService } from './worker/worker.service';

/** Background worker process (same image as the API, separate deployment). */
async function main() {
  const ctx = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  ctx.enableShutdownHooks();
  const worker = ctx.get(WorkerService);
  const stop = () => {
    Logger.log('worker stopping', 'Worker');
    worker.stop();
    setTimeout(() => ctx.close().then(() => process.exit(0)), 3000);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  await worker.run(Number(process.env.WORKER_INTERVAL_MS ?? 2000));
}

main().catch((e) => {
  console.error(JSON.stringify({ level: 'fatal', msg: 'worker_startup_failed', error: (e as Error).message }));
  process.exit(1);
});
