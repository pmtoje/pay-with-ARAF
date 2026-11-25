import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { CONFIG, type AppConfig } from './config';
import { WorkerService } from './worker/worker.service';

async function main() {
  const app = await createApp();
  const config = app.get<AppConfig>(CONFIG);
  await app.listen(config.API_PORT, '0.0.0.0');
  Logger.log(`Pay with ARAF API listening on :${config.API_PORT} (${config.APP_ENV}, ${config.PLATFORM_ENVIRONMENT})`, 'Bootstrap');
  // Local convenience only: run the worker in-process when explicitly requested.
  if (process.env.RUN_WORKER_IN_PROCESS === 'true' && config.APP_ENV === 'local') {
    void app.get(WorkerService).run(1500);
    Logger.log('In-process worker enabled (local only)', 'Bootstrap');
  }
}

main().catch((e) => {
  // Fail closed: refuse to start on unsafe or invalid configuration.
  console.error(JSON.stringify({ level: 'fatal', msg: 'startup_failed', error: (e as Error).message }));
  process.exit(1);
});
