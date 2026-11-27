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

## Domains — araf.ng

| Host | Serves | Exposure |
| --- | --- | --- |
| `araf.ng` | 301 → `https://www.araf.ng` | Public |
| `www.araf.ng` | Public homepage, hosted checkout `/c/{session}`, embed SDK `/v1/araf.js` (customer-checkout app) | Public, behind WAF/DDoS/CDN |
| `api.araf.ng` | Partner API `/api/v1`, provider callbacks `/api/callbacks`, health | Public, server-to-server |
| `partners.araf.ng` | Partner portal | Public (MFA) |
| `developers.araf.ng` | Developer documentation (both environments) | Public |
| `admin.araf.ng` | Bank admin portal | **Internal DNS / VPN only** |
| `sandbox.araf.ng`, `api.sandbox.araf.ng`, `partners.sandbox.araf.ng`, `admin.sandbox.araf.ng` | Sandbox equivalents (synthetic data, simulators) | As above |
| `demo.sandbox.araf.ng` | AltMall demo store (sandbox only; real merchants host their own sites) | Public |

Ready-made settings: `infrastructure/env/araf.ng.production.env.example`,
`infrastructure/env/araf.ng.sandbox.env.example`; reverse proxy: `infrastructure/nginx/araf.ng.conf`
(HTTPS only, HSTS, apex → www, `/api/admin`, `/api/sandbox` and `/metrics` blocked on the public API
host, admin restricted to the Bank network). The proxy **overwrites** `X-Forwarded-For` and the API
trusts `TRUST_PROXY_HOPS=2`, so rate limits and audit logs see each customer's real IP.
`NEXT_PUBLIC_*` values are inlined when the web images are built — build one image set per environment.

Before go-live: register `araf.ng` (and look-alikes such as `araf.com.ng`) through a NiRA-accredited
registrar under the Bank's name; TLS certificates for `araf.ng` and `*.araf.ng`; DNSSEC; CAA records;
SPF, DKIM and DMARC (`p=reject`) for any mail sent from `araf.ng`; link to `www.araf.ng` from the
Bank's main website so customers can verify it is genuine.

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

## Render (native Node, no Docker)
Deploy from the same repository (root directory = repo root) as two services. Both use the shared
pnpm workspace; there is no per-app repository.

Build command (API and worker):
```bash
corepack enable && pnpm install --frozen-lockfile \
  && pnpm --filter "./packages/*" build \
  && pnpm --filter @araf/api build
```
Start commands:
* API web service: `node apps/api/dist/main.js` (health check `/health/live`)
* Worker background service: `node apps/api/dist/worker.js`

Set `NODE_VERSION=22`. The API honours `PORT` automatically (it falls back to `API_PORT`, then 4000),
so leave `API_PORT` unset unless you need to override the host. Attach a persistent disk to the API
at `/data` and set `STORAGE_DIR=/data/storage`; the worker does not need it. Apply future migrations
with a pre-deploy command (`pnpm --filter @araf/database migrate:deploy`) or from CI/local against
the direct/session pooler URL. The worker must run as its own service in every non-local environment.

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

## Shared database (Supabase)
AltMall normally has its own database. When it shares the Pay with ARAF Supabase project, its tables
stay in a dedicated `altmall` schema — never `public`. Provision the schema and the `altmall_app`
role once, as `postgres`, from the Supabase SQL editor:

1. Set a strong password in `infrastructure/supabase/altmall-schema.sql` (from the secrets manager).
2. Run the file. It creates the schema/role, grants access and sets the role's `search_path`.
3. Point `ALTMALL_DATABASE_URL` at the pooler with the `altmall_app.<project-ref>` username, set
   `ALTMALL_DB_SCHEMA=altmall` and `ALTMALL_DB_POOL_MAX=1` for serverless hosts.

The demo store fails closed if it connects while `ALTMALL_DB_SCHEMA` is set but the active schema
differs, so a missing grant cannot silently create tables in `public`. Local Docker continues to use
a separate `altmall` database (`infrastructure/docker/init-altmall.sql`).

Connection notes for Supabase:
* The direct host `db.<project-ref>.supabase.co` is IPv6-only on new projects. From an IPv4-only
  machine or service, run migrations through the **session pooler** on port 5432 instead.
* Prisma (API/worker): `postgresql://postgres.<project-ref>:<password>@<region>.pooler.supabase.com:5432/postgres?sslmode=require`.
  On serverless hosts use the transaction pooler on 6543 with `?pgbouncer=true&connection_limit=1`.
* AltMall uses `pg`, not Prisma. Its URL needs `?uselibpqcompat=true&sslmode=require` — `pg` 8
  treats a plain `sslmode=require` as `verify-full` and rejects Supabase's certificate chain.
* URL-encode reserved characters in the password (for example `$` → `%24`). The pooler user is
  `postgres.<project-ref>` / `altmall_app.<project-ref>`, never plain `postgres`.

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
