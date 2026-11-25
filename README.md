# Pay with ARAF

**Embedded non-interest financing gateway — The Alternative Bank (sandbox build).**

Merchants add *Pay with ARAF* at checkout like a payment gateway. Customers are redirected to a
Bank-hosted journey (identity → credit → account → statement → affordability → offer), the
application is handed to the ARAF workflow, the Bank pays the vendor, and goods are released only
after confirmed payment and the Murabaha contractual conditions. *The partner sells. Pay with ARAF
originates. ARAF processes and approves. The Bank pays. The vendor delivers. The customer repays.*

> **Status:** complete sandbox system with simulated integrations. **Not production-ready** —
> live integrations, Bank approvals and independent security testing are outstanding
> (`PRODUCTION_READINESS.md`). All credit/pricing values are **PROPOSED**, not approved policy.

## Applications (local)

| App | URL | Sign-in |
| --- | --- | --- |
| API | http://localhost:4000 (`/health/ready`) | — |
| Hosted checkout | http://localhost:3001/c/{session_id} | Customer OTP (sandbox inbox) |
| Partner portal | http://localhost:3002 | AltMall admin — see `SANDBOX_CREDENTIALS.local.md` (created by bootstrap) |
| Bank admin portal | http://localhost:3003 | Staff accounts below |
| Developer portal | http://localhost:3004 | Public |
| AltMall demo store | http://localhost:3005 | `demo@altmall.example` / `Demo-Shopper-2026!` |

**Sandbox staff accounts** (synthetic, sandbox only): `<role>@sandbox.altbank.example`, password
`Sandbox-Pass-2026!`, TOTP via `node scripts/totp.mjs <email>` (or add the secret printed by the
same derivation to an authenticator). Roles: `superadmin`, `business`, `onboarding`,
`partner.approver`, `analyst`, `risk`, `approver`, `cad`, `settlement`, `finance`, `ops`, `cx`,
`compliance`, `infosec`, `auditor`, `developer`, `management`.

**Sandbox test customers:** BVN `22200000001` / DOB `1990-04-12` (good credit, existing account) and
more in the Developer portal → *Sandbox testing* (`packages/integrations/src/sandbox/scenarios.ts`).
All identities are synthetic; BVNs in the `222000000xx` range never resolve in production.

## Quick start
```bash
pnpm install
node scripts/generate-env.mjs > .env          # random local secrets; never commit
# Postgres 16 + Redis 7 running locally (or: docker compose up postgres redis)
createdb araf && createdb altmall
pnpm --filter "./packages/*" build
(cd packages/database && npx prisma migrate deploy)
set -a && . ./.env && set +a && node packages/database/dist/seed.js
pnpm --filter @araf/api build
RUN_WORKER_IN_PROCESS=true node --env-file=.env apps/api/dist/main.js &
node scripts/demo-bootstrap.mjs               # onboards AltMall through the real APIs
pnpm --parallel --filter "@araf/{customer-checkout,partner-portal,admin-portal,developer-portal,altmall-demo}" dev
```
Full stack in containers: `docker compose up --build` (see `DEPLOYMENT.md`).

## Demonstration script (Definition of Done)
1. `node scripts/demo-bootstrap.mjs` — onboarding officer creates AltMall; partner approving
   officer approves (maker-checker); AltMall admin enrols MFA; sandbox key + webhook configured.
2. AltMall (3005): add a smartphone, checkout, choose **Pay with ARAF** → hosted checkout (3001).
3. Accept consents, BVN `22200000001`, DOB `1990-04-12`, OTP from the sandbox drawer/inbox.
4. Select the AltBank account → *Salary earner* → *Use my AltBank statement* → offer appears →
   choose tenor → accept.
5. Admin portal (3003) → *ARAF simulator*: `analyst@` starts/complete evaluation and recommends;
   `approver@` approves.
6. Customer signs documents (OTP) and authorises the Remita mandate (sandbox page).
7. `cad@` verifies the vendor invoice and books; `settlement@` initiates the vendor payment;
   `finance@` approves it in *Approvals*; payment confirms (simulated).
8. `cad@` records possession evidence; customer executes the sale agreement (OTP) → release
   authorised → signed webhook to AltMall.
9. AltMall vendor console (`/vendor`) dispatches and delivers; customer sees *Delivered*; dashboards
   reflect the lifecycle.
The same flow is automated in `apps/api/test/e2e-journey.test.ts`.

## Repository
```
apps/        api (NestJS API + worker) · customer-checkout · partner-portal · admin-portal · developer-portal · altmall-demo
packages/    business-rules · security · database · integrations · types · ui · design-tokens
documentation/ FRONTEND_GUIDE · UAT_PACK · SECURITY_ASSESSMENT · openapi.yaml
infrastructure/ docker
scripts/     generate-env · demo-bootstrap · totp · scan-secrets
```
The worker shares the API codebase (`apps/api/src/worker.ts`); see `DECISIONS.md` D-001.

## Tests
```bash
pnpm --filter @araf/business-rules test   # 94
pnpm --filter @araf/security test         # 36
pnpm --filter @araf/integrations test     #  7
pnpm --filter @araf/api test              # 41 (end-to-end lifecycle + scenarios + security)
```

## Documentation
`ARCHITECTURE.md` · `PRODUCT_REQUIREMENTS.md` · `BUSINESS_RULES.md` · `SECURITY.md` ·
`THREAT_MODEL.md` · `IMPLEMENTATION_PLAN.md` · `INTEGRATION_GUIDE.md` · `API_DOCUMENTATION.md` ·
`TEST_PLAN.md` · `REQUIREMENTS_TRACEABILITY.md` · `DEPLOYMENT.md` · `DECISIONS.md` ·
`PRODUCTION_READINESS.md` · `CHANGELOG.md` · `documentation/`.
