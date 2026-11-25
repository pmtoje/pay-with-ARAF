import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load the local .env, then force an isolated test database and fast simulators.
const envFile = resolve(__dirname, '../../../.env');
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^'(.*)'$/, '$1');
}
process.env.APP_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://araf:araf_local_dev@localhost:5432/araf_test';
process.env.SANDBOX_ASYNC_DELAY_MS = '0';
process.env.RATE_LIMIT_MULTIPLIER = '50'; // many journeys from one test IP
process.env.STORAGE_DIR = resolve(__dirname, '../../../storage-test');
