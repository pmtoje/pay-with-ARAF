# Deployment

## Environments

| Environment | `APP_ENV` | `PLATFORM_ENVIRONMENT` | Integrations | Purpose |
| --- | --- | --- | --- | --- |
| Local | `local` | SANDBOX | Simulators | Development |
| Test (CI) | `test` | SANDBOX | Simulators | Automated tests (fresh DB per run) |
| Sandbox | `sandbox` | SANDBOX | Simulators | Partner integration testing |
| UAT | `uat` | SANDBOX | Simulators / provider test envs | Stakeholder UAT |
| Staging | `staging` | SANDBOX | Provider test environments | Pre-production rehearsal |
| Production | `production` | PRODUCTION | Live adapters only | Live operation (locked until gates pass) |

Production **fails closed** at start-up if: `COOKIE_SECURE` is false, private-network webhooks
are allowed, any public URL is not HTTPS, `RATE_LIMIT_MULTIPLIER` is set, or the record
environment is not PRODUCTION. `LIVE_OPERATIONS_ENABLED` is only accepted in production and must
stay `false` until every gate in `PRODUCTION_READINESS.md` is signed off. Sandbox tools, the
scenario selector and simulator endpoints are unreachable unless the deployment is SANDBOX and not
production.

## Local development (no Docker)

Prerequisites: Node 22, pnpm 10, PostgreSQL 16, Redis 7.

```bash
pnpm install
node scripts/generate-env.mjs > .env                 # fresh random local secrets (never commit)
createdb araf && createdb altmall                     # or use the compose stack
pnpm --filter "./packages/*" build
cd packages/database && npx prisma migrate deploy && cd -
set -a && . ./.env && set +a && node packages/database/dist/seed.js
pnpm --filter @araf/api build
RUN_WORKER_IN_PROCESS=true node --env-file=.env apps/api/dist/main.js   # API + worker (local only)
node scripts/demo-bootstrap.mjs                      # onboard AltMall via the real APIs
pnpm --filter @araf/customer-checkout dev            # :3001
pnpm --filter @araf/partner-portal dev               # :3002
pnpm --filter @araf/admin-portal dev                 # :3003
pnpm --filter @araf/developer-portal dev             # :3004
pnpm --filter @araf/altmall-demo dev                 # :3005
```
In non-local environments run the worker as its own process: `node apps/api/dist/worker.js`.

## Docker
`docker compose up --build` runs Postgres, Redis, migrations, API, worker and the five web apps.
Images: `infrastructure/docker/api.Dockerfile` (API/worker, non-root, tini, health check) and
`infrastructure/docker/web.Dockerfile` (`--build-arg APP=<app>`).

## Configuration
See `.env.example`. Secrets (`ENCRYPTION_KEYS`, `BLIND_INDEX_KEY`, `API_KEY_PEPPER`, `OTP_PEPPER`,
`STATE_TOKEN_KEY`, `INTERNAL_CALLBACK_SECRET`) must come from the Bank's secrets manager/KMS
outside local development. Encryption keys are versioned (`{"k1":…, "k2":…}` + `ENCRYPTION_ACTIVE_KEY`)
to support rotation without re-encrypting at once.

## Database migrations
Prisma migrations in `packages/database/prisma/migrations` (including a hand-written integrity
migration). Deploy with `prisma migrate deploy` (never `migrate reset` outside disposable local
databases). Practice: expand → migrate data → contract, so the previous release keeps working
during roll-out (backward-compatible migrations).

## Release & approval gates
* CI (`.github/workflows/ci.yml`) must pass: secret scan, unit + integration + end-to-end tests,
  web builds, dependency audit, container build/scan.
* Production deployments only from reviewed, tagged releases on the protected main branch, approved
  through the Bank's change-management board (Technology, InfoSec, Operations). No deployment from
  feature branches.

## Rollback
Applications: redeploy the previous image tag (stateless). Database: migrations are
backward-compatible, so roll back code first; data-destructive migrations require a separately
approved plan. Feature switches: `LIVE_OPERATIONS_ENABLED=false` halts live financial operations;
suspend a partner from the admin portal to stop new sessions.

## Backup & recovery (proposed — subject to Bank approval)
* PostgreSQL: continuous WAL archiving + point-in-time recovery; daily full backups retained 35 days;
  monthly restore tests into an isolated environment with integrity checks (audit hash chain
  verification, reconciliation run).
* Object storage: versioning + cross-region replication; encrypted with KMS keys.
* Proposed objectives: **RPO ≤ 5 minutes**, **RTO ≤ 1 hour** for API/worker; availability objective
  **99.9%** (SWR minimum 95%). Exceeds-availability claims require Bank infrastructure approval.
* Recovery runbook: restore DB to PIT → start API in maintenance (partner keys disabled) → run
  reconciliation against core banking and payment rails → resolve discrepancies → re-enable.

## Observability
Structured JSON access logs (no bodies/query strings) with correlation ids; integration logs with
latency and outcome (no payloads); `/metrics` (outbox backlog, webhook backlog/dead letters,
unknown payments, open exceptions, analyses in flight); `/health/live` and `/health/ready`.
Production should add an OpenTelemetry SDK + collector (traces across API, worker and adapters),
SIEM forwarding of audit and security events, and alerting on the metrics above.
