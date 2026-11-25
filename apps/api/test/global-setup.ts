import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import './setup-env';

/**
 * Non-destructive test isolation: every run creates a NEW uniquely named database, applies
 * migrations with `prisma migrate deploy` and seeds it. Nothing existing is ever dropped.
 * (Set TEST_DATABASE_URL to reuse a specific, already-migrated database instead.)
 */
export default function setup() {
  const root = resolve(__dirname, '../../..');
  if (!process.env.TEST_DATABASE_URL_FIXED) {
    const name = `araf_test_${Date.now()}`;
    const admin = new URL(process.env.DATABASE_URL!);
    execSync(`psql "postgresql://${admin.username}:${admin.password}@${admin.host}/postgres" -c "CREATE DATABASE ${name}"`, { stdio: 'pipe' });
    admin.pathname = `/${name}`;
    process.env.TEST_DATABASE_URL = admin.toString();
    process.env.DATABASE_URL = admin.toString();
  }
  const env = { ...process.env };
  execSync('npx prisma migrate deploy', { cwd: resolve(root, 'packages/database'), env, stdio: 'pipe' });
  execSync('node dist/seed.js', { cwd: resolve(root, 'packages/database'), env, stdio: 'pipe' });
  execSync('redis-cli --scan --pattern "rl:*" | xargs -r redis-cli del', { env, stdio: 'pipe', shell: '/bin/bash' });
}
