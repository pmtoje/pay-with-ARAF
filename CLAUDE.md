# CLAUDE.md — guidance for AI assistants working in this repository

## What this is
Pay with ARAF — embedded non-interest (Murabaha) financing gateway (sandbox build). pnpm +
Turborepo monorepo; NestJS API + worker; five Next.js apps; Prisma/PostgreSQL; Redis.

## Non-negotiables
* Money is integer kobo (`bigint` in rules/DB). Never use floating point for money.
* Never authorise goods release outside `OperationsService.evaluateRelease` (pure gate in
  `packages/business-rules/src/release-gate.ts`).
* Never retry a vendor payment blindly; UNKNOWN must be reconciled (`reconcileInstruction`).
* Every application state change goes through `StateService.transitionApplication` (state machine,
  optimistic concurrency, history, outbox). Lock the row (`AppContextService.lockApplication`) for
  multi-step financial actions.
* Every route needs an auth decorator (`@Public`, `@Staff(...)`, `@PartnerUser(...)`, `@ApiKey(...)`,
  `@Customer()`); undecorated routes are denied. Partner tenancy comes from the credential/session
  only — filter by `partnerId` **and** `environment`.
* Never expose credit data to partners; never show scores to customers; never put BVN/OTP in URLs
  or logs. Encrypted fields use AAD — re-encrypt when copying between records.
* Do not invent provider API formats. Live adapters fail closed until real specs exist.
* Do not mark proposed policies as approved; do not fake stakeholder sign-offs.
* Do not run `prisma migrate reset` against shared databases. Tests create a fresh DB per run.

## Commands
```bash
pnpm install
pnpm --filter "./packages/*" build
pnpm --filter @araf/business-rules test && pnpm --filter @araf/security test && pnpm --filter @araf/integrations test
pnpm --filter @araf/api build && pnpm --filter @araf/api test     # needs Postgres + Redis + .env
node scripts/scan-secrets.mjs
```
Local run: see `DEPLOYMENT.md`. Demo bootstrap: `node scripts/demo-bootstrap.mjs`.
TOTP for seeded staff: `node scripts/totp.mjs analyst@sandbox.altbank.example`.

## Where things are
Rules `packages/business-rules` · crypto/SSRF/webhooks `packages/security` · adapters & simulators
`packages/integrations` · schema `packages/database/prisma` · API modules `apps/api/src/*` · tests
`apps/api/test` · docs at repo root + `documentation/`.
