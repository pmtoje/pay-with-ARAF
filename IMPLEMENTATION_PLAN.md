# Implementation plan & checklist

Phases follow spec §69. ✅ done · 🟡 done with follow-ups · ⛔ blocked externally.

## Phase 1 — Discovery & architecture ✅
- [x] Inspect environment/repositories (empty repository; no source documents supplied)
- [x] Requirements traceability (`REQUIREMENTS_TRACEABILITY.md`)
- [x] Conflicts & dependencies recorded (`DECISIONS.md`, `PRODUCTION_READINESS.md`)
- [x] Architecture (`ARCHITECTURE.md`), design system (`packages/design-tokens`, `packages/ui`)

## Phase 2 — Foundation ✅
- [x] Monorepo (pnpm + Turborepo), Postgres schema + integrity migration, seed
- [x] Authentication, TOTP MFA, sessions, CSRF, RBAC, tenant isolation, audit chain

## Phase 3 — Partner infrastructure ✅
- [x] Onboarding wizard API, maker-checker approvals, provisioning, credentials, webhooks, team

## Phase 4 — AltMall integration 🟡
- [x] Checkout API, hosted checkout routes, return URL handling
- [x] Demo storefront (built by the AltMall workstream; see final report)

## Phase 5 — Identity & credit ✅
- [x] BVN adapter, OTP, SeedFi adapter, decision engine, enhanced assessment

## Phase 6 — Account verification ✅
- [x] Existing accounts, account opening redirect, signed callback, resumption

## Phase 7 — Financial analysis ✅
- [x] AltBank, Mono, PDF acquisition; Periculum adapter; normalisation

## Phase 8 — Eligibility & offers ✅
- [x] Salary rules, business-owner review, affordability, exposure reservations, offers, PDF summary

## Phase 9 — ARAF integration ✅ (⛔ live ARAF)
- [x] Idempotent submission, status events, simulator, documentation, mandate

## Phase 10 — Financial operations ✅
- [x] Booking, maker-checker vendor payment, unknown-status reconciliation, release gate,
      fulfilment, cancellations/returns/refunds, reconciliation runs

## Phase 11 — Dashboards & reporting 🟡
- [x] Report APIs (overview, funnel, credit, operations, portfolio-unavailable, CSV)
- [x] Partner & admin portal UIs (parallel workstreams; see final report)

## Phase 12 — Developer experience 🟡
- [x] OpenAPI, docs, explorer, verifier (developer portal workstream)

## Phase 13 — Quality assurance 🟡
- [x] Unit, integration, end-to-end and security suites (176 tests passing)
- [ ] Load testing, automated accessibility audits, cross-app Playwright in CI

## Phase 14 — Deployment readiness 🟡
- [x] Dockerfiles, compose, CI, deployment/rollback/backup docs, UAT pack, readiness assessment
- [ ] Bank pipeline integration, KMS, WAF, SIEM (⛔ Bank infrastructure)
