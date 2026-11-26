# Test plan

## Strategy
1. **Unit** — pure business rules, security primitives and simulators (Vitest). Exhaustive boundary
   coverage for money, ratios, bands, tenors, rounding, salary, cart, exposure, release gate and
   state machines.
2. **API integration / end-to-end** — the NestJS app in-process against a **fresh PostgreSQL
   database per run** (non-destructive isolation) and Redis, driven only through HTTP (supertest)
   exactly as browsers, merchants and staff would: real auth (password + TOTP), CSRF, API keys,
   maker-checker, simulators, worker ticks and a real signed-webhook receiver.
3. **Browser** — Playwright checks of the web apps (journeys, mobile 375–390 px and desktop
   1280–1440 px screenshots) performed during build-out; see the final implementation report.
4. **Security** — negative tests in the API suite (spec §65) plus unit tests of the crypto/SSRF/
   webhook primitives; dependency, secret and container scans in CI.

## Commands
```bash
pnpm --filter @araf/business-rules test     # 110 tests
pnpm --filter @araf/security test           # 36 tests
pnpm --filter @araf/integrations test       #  7 tests
pnpm --filter @araf/api test                # 46 tests (e2e lifecycle + scenarios/security)
node scripts/scan-secrets.mjs
```

## Mandatory business-rule cases (spec §64) → `packages/business-rules/test/rules.test.ts`
* Scores 279/280/529/530/619/620/800/801 ✔ · missing score never 0 ✔ · malformed scores invalid ✔
* Ratio 33.299% / 33.300% within, 33.301% above, exact decimals ✔ · zero/negative income ✔ ·
  zero obligations ✔ · obligations exceeding capacity ✔
* Missing salary, split salary, duplicates, insufficient history, uncertain classification ✔
* Per-annum product pricing: 25% p.a. → 6 m 12.5%, 12 m 25%, 18 m 37.5%, 24 m 50%; other product
  rates; 25 months unsupported; invalid rates rejected ✔ · schedule reconciles to DSP ✔
* Business owners: capacity = 10% of turnover − obligations; 10.000% within / 10.001% above ✔
* Equity: ₦5m item − ₦2m equity → ₦3m financed, markup on ₦3m only; minimum/maximum equity ✔
* Single obligor below / at / above limit, existing exposure, concurrent reservations ✔
  (concurrency additionally end-to-end in SCN 28)
* Goods release matrix: eligibility only, approved, booked, initiated, failed, unknown, confirmed
  without condition → blocked; confirmed + all conditions → authorised ✔
* Spec worked example: ₦480,000 / ₦50,000 → capacity ₦109,840 → ₦1,054,464 (12 m) ✔ (unit,
  simulator chain, and through the API)

## Sandbox scenarios (spec §60) → automated coverage

| # | Scenario | Test |
| --- | --- | --- |
| 1 | Good credit, existing customer | E2E |
| 2 | Good credit, new customer | SCN "new customer…" |
| 3 / 4 | Fair credit approved / declined | SCN 3, SCN 4 |
| 5 | Poor credit | SCN 5 |
| 6 | No credit history | SCN 6 |
| 7 | AltBank statement | E2E |
| 8 | Mono statement | SCN new customer |
| 9 / 10 | PDF upload valid / invalid | SCN 9/10 |
| 11 | Missing salary month | SCN 11 |
| 12 | High obligations | SCN 12 |
| 13 | Insufficient eligibility | SCN 13 (incl. revised cart) |
| 14 | Business owner | SCN 14 |
| 15 | ARAF submission | E2E |
| 16 | ARAF rejection | SCN 16 |
| 17 | Mandate failure | SCN 17 |
| 18 | Booking failure | SCN 18 |
| 19 | Vendor payment failure | SCN 19 |
| 20 | Unknown payment status | SCN 20/27 |
| 21 / 22 | Successful payment / release | E2E |
| 23 | Webhook failure & retry | SCN 23 |
| 24 | Delivery | E2E |
| 25 | Return & refund | partial (workflow implemented; manual UAT-OPS-03) |
| 26 | Duplicate checkout | E2E |
| 27 | Duplicate payment prevention | E2E + SCN 20/27 (DB index) |
| 28 | Concurrent exposure | SCN 28 |
| 29 | Account opening interrupted & resumed | SCN new customer |
| 30 | Abandonment & resumption | E2E (resume OTP), SCN inactivity |

## Security tests (spec §65) → `apps/api/test/scenarios.test.ts`
Broken access control / IDOR / cross-tenant ✔ · privilege (least privilege, maker≠checker) ✔ ·
authentication bypass (unauthenticated, wrong portal, invalid/revoked keys) ✔ · MFA (TOTP
replay protection in harness) ✔ · OTP brute force & replay ✔ · CSRF ✔ · SQL injection (search
input) ✔ · error leakage ✔ · malicious upload (JS, encrypted, malware, non-PDF) ✔ · webhook
forgery & replay (SEC) ✔ · SSRF (SEC unit; private-network blocking) ✔ · duplicate payment ✔ ·
cart / amount manipulation ✔ · state-machine bypass ✔ · unauthorised approval / payment / release
✔ · race conditions (exposure, duplicate checkout advisory lock, payment unique index) ✔ ·
sensitive information leakage to partners ✔ · ARAF callback forgery, stale & duplicate events ✔ ·
session fixation (session rotation after MFA — code review) · XSS (React escaping, JSON API, CSP —
code review; no HTML rendering of user content).

## Results (latest local run)
* business-rules 110/110 ✔ · security 36/36 ✔ · integrations 7/7 ✔ · API 46/46 ✔ (11 lifecycle + 35
  scenario/security) — total **199 passing, 0 failing** (2026-11-26).
* All five web apps pass `next build`; each was exercised in Playwright (Chromium) at mobile and
  desktop widths against the live sandbox API during build-out, plus a final cross-app smoke run.
* Defects found by the suites and fixed: see `DECISIONS.md` D-020.

## Customer equity, product pricing, business owners (D-023 – D-025)
SCN: equity required instead of cart revision → bounds enforced → profit on the financed amount →
equity change withdraws the offer → merchant confirmation only after approval, exact amount,
idempotent → vendor payment blocked until confirmed, then pays only the financed amount →
`EQUITY_CONFIRMED` reported to ARAF before payment. SCN: partner at 20% p.a. prices differently;
tenors above 24 months refused. SCN 14: business owner assessed at 10% of Periculum turnover with
the SeedFi check on file.

## ARAF execution reporting (D-013)
E2E: full ordered report sequence acknowledged by the ARAF simulator · SCN: reporting outage → booking
still completes, strict ordering while retrying, exception after 5 attempts, re-queue and exactly-once
acknowledgement · SCN: booking failure reported.

## Not yet automated
Cross-app Playwright suite in CI (browser checks were run during build-out), load/performance tests,
accessibility audit tooling (axe) in CI, DR restore test.
