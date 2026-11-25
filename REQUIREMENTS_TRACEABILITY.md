# Requirements traceability matrix

Source authority: the *Pay with ARAF Master Specification* (sections §1–§73). The SeedFi SWR and
other source documents (§3) were **not supplied**; SWR-derived values are taken from the
specification text and marked PROPOSED. Test IDs: `BR` = `packages/business-rules/test/rules.test.ts`,
`SEC` = `packages/security/test/security.test.ts`, `INT` = `packages/integrations/test/sandbox.test.ts`,
`E2E` = `apps/api/test/e2e-journey.test.ts`, `SCN` = `apps/api/test/scenarios.test.ts`.

Status: ✅ implemented & tested · 🟡 implemented, partially tested / UI pending verification ·
⛔ blocked by external dependency (simulated in sandbox) · ➖ out of scope by spec.

| Ref | Requirement | Implementation | Acceptance criteria | Tests | Status | Outstanding dependency |
| --- | --- | --- | --- | --- | --- | --- |
| §3 | Proposed interpretations configurable, not claimed approved | `credit_policy_versions.isProposed`, `PROPOSED_SANDBOX_POLICY` | All values in versioned policy; flagged proposed | BR policy validation | ✅ | Credit Risk approval |
| §5.1 | Hosted customer checkout | `apps/customer-checkout`, `customer.controller.ts` | Full journey usable on mobile | E2E 9–30, SCN | 🟡 | — |
| §5.2 | Partner portal | `apps/partner-portal`, `partner-portal.controller.ts` | Tracking, release queue, settlements, integration, team | E2E 26–30, SCN tenant | 🟡 | — |
| §5.3 | Bank admin portal | `apps/admin-portal`, `admin.controller.ts` | Onboarding, reviews, ops, reports, audit, RBAC | E2E, SCN | 🟡 | — |
| §5.4 | Developer portal | `apps/developer-portal`, `documentation/openapi.yaml` | Docs, explorer, verifier, samples | build | 🟡 | — |
| §5.5 / §61 | AltMall demo via public APIs only | `apps/altmall-demo` (own DB, API key, signed webhooks) | No privileged DB access; webhook verified | build + manual | 🟡 | — |
| §5.6 / §33 | ARAF workflow simulator | `araf.service.ts` (sim*), admin simulator UI | Stages, info requests, approve/reject, maker-checker | E2E 18, SCN ARAF tests | ✅ | ARAF API |
| §6 | Brand & design system, light/dark, WCAG 2.2 AA | `packages/design-tokens`, `packages/ui` | Tokens documented as provisional | visual review | 🟡 | Official brand assets (D-004) |
| §7 | Recommended stack | Turborepo, Next.js, TS, Tailwind, NestJS, Postgres, Prisma, Redis | — | — | ✅ (BullMQ → outbox, D-002) | — |
| §8 | Event-driven, outbox, idempotency, compensations | `OutboxService`, `WorkerService`, `IdempotencyService`, reconciliation | No dual writes; retries idempotent | E2E, SCN 20/23 | ✅ | — |
| §9 | Multi-tenant isolation at all layers | guard + scoped queries + tests | Foreign ids → 404 | SCN tenant isolation | ✅ | — |
| §9 | Marketplace: partner ≠ vendor ≠ beneficiary | `vendors`, `vendor_settlement_accounts` | Payment to approved vendor account | E2E 22 | ✅ | — |
| §10.1–10.3 | Partner onboarding, configuration, lifecycle, maker-checker | `partners.service.ts`, `approvals.service.ts`, `PARTNER_TRANSITIONS` | Maker cannot approve; statuses per lifecycle | E2E onboarding, SCN | ✅ | — |
| §10.4 | Automatic provisioning | `provision()` | Config active, admin invited, sandbox active | E2E | ✅ (key issued on first use, D-019) | — |
| §11 | API credential management | `generateApiKey`, credentials endpoints | Shown once, hashed, scopes, rotation, revocation, IP allowlist, last used | SEC, SCN auth | ✅ | — |
| §12 | Checkout initiation & validation | `checkout.service.ts` | Schema, cart arithmetic, limits, vendors, URLs, duplicates, idempotency | E2E 1–8 | ✅ | — |
| §13 | Progressive journey, save & resume | checkout app, `view()` | Stages, resume after interruption | E2E, SCN resume | 🟡 | — |
| §14 | BVN/DOB, OTP via identity-linked channel | `journey.service.ts` | 5-min single-use hashed OTP; attempts; cooldown; encryption; masking | SCN OTP brute force/replay, identity | ✅ | BVN service |
| §15 | Consent capture (versioned, auditable, no bundling) | `CONSENTS`, `customer_consents` | Required consents enforced; marketing separate | SCN consent | ✅ | Approved texts |
| §16 | SeedFi assessment, decision matrix | `classifyScore`, `runCreditCheck` | Boundaries; invalid ≠ poor; missing ≠ 0 | BR, SCN SeedFi | ✅ | SeedFi API |
| §17 | Poor credit journey | `runCreditCheck` | Decline, respectful message, partner notified w/o details | SCN 5 | ✅ | — |
| §18 | Fair credit enhanced assessment + reviewer decisions | `submitEnhancedInfo`, `reviews.service.ts` | Form, queue, maker-checker decision, policy version | SCN 3/4 | ✅ | — |
| §19 | Good credit continues (not approval) | state machine | → account verification | E2E | ✅ | — |
| §20 | AltBank account verification | `listAccounts`, `selectAccount` | Masked; ineligible not selectable; BVN ownership | E2E, SCN | ✅ | AltBank API |
| §21 | Account opening integration + resume | `startAccountOpening`, `verifyOpenedAccount`, callbacks | Signed state; redirect not trusted; callback verified; resume | SCN 2/8/29 | ✅ | Account opening platform |
| §22 | Income profile (6 vs 12 months, BO manual review) | `setIncomeProfile`, policy | Required months by profile | SCN 14 | ✅ | — |
| §23 | Three statement channels → unified pipeline | `statements.service.ts` | AltBank, Mono (no passwords), PDF (validation, malware, duplicates, encryption) | SCN 2/9/10 | ✅ | Mono, AV service |
| §24 | Periculum adapter & normalised model | `StatementAnalysisProvider`, `statement_analysis_results` | Provider vs Bank-derived separated | INT, E2E | ✅ | Periculum API |
| §25 | Salary rules (lowest verified, split, duplicates, missing) | `assessSalary` | Spec example ₦480k; missing → decline only if reliable | BR, INT, SCN 11 | ✅ | — |
| §26 | Business owner assessment → manual review | `evaluate()` | Queue + 24–48h target | SCN 14 | ✅ | BO model approval |
| §27 | Affordability engine, exposure, reservations | `computeEligibility`, `computeAndReserve` | 33.3% exact; capacity; ₦5m limit; concurrent safety | BR, SCN 28 | ✅ | Exposure definition (D-008) |
| §28 | Markup & tenor engine, rounding | `priceDeferredSale`, `maxAffordableFinancing` | 25%/50%; schedule sums to DSP; spec example ₦1,054,464 | BR, E2E | ✅ | — |
| §29 | Cart comparison A–D, no cash-out | `compareEligibilityToCart`, revised sessions | Partial disabled by default | BR, SCN 13 | ✅ | Partial financing approval |
| §30 | Offer experience (tenor compare, schedule, PDF, disclaimers) | `offerOptions`, `selectTenor`, `acceptOffer`, `offerSummaryPdf` | Unaffordable options blocked; indicative ≠ approval | E2E | 🟡 | — |
| §31 | Non-interest structure, Murabaha sequence | conditions, documents, `signSaleContract` | Sale only after acquisition; terminology | E2E 23–25 | ✅ (sequence PROPOSED) | Shariah approval (D-011) |
| §32 | Idempotent ARAF handover, never claim submission early | `ArafService.submit` | Lookup before retry; ack before "submitted" | E2E, SCN | ✅ | ARAF API |
| §34 | Remita mandate | `startMandate`, `verifyMandate` | Authoritative verification; failure handling | E2E, SCN 17 | ✅ | Remita |
| §35 | Booking with verification & failure handling | `requestBooking` | Block payment on failure; reconcile before retry | E2E, SCN 18 | ✅ | Core banking |
| §36 | Vendor payment lifecycle, unknown status, no duplicates | `initiatePayment`, `executePayment`, `reconcileInstruction`, DB index | Maker-checker; UNKNOWN reconciled; never re-initiate | E2E 22, SCN 19/20 | ✅ | Payment rail |
| §37 | Goods release authorisation & verification API | `evaluateRelease`, `/v1/releases/{ref}`, suspension | Gate matrix; signed webhook | BR gate, E2E 23–25 | ✅ | — |
| §38 | Fulfilment tracking, duplicates prevented | `fulfil`, `deliver`, customer confirmation | Distinct statuses | E2E 26–30 | ✅ | — |
| §39 | Returns, cancellations, refunds | `cancelOrder`, `requestReturn`, `startRefund`, `pollRefunds` | Vendor → Bank; reconcile before adjust; history kept | partial (SCN), manual | 🟡 | Refund arrangements |
| §40 | Explicit state machines; derived statuses; concurrency; history | `state-machines.ts`, `StateService` | Bypass impossible | BR, SCN state bypass | ✅ | — |
| §41 | Partner dashboard contents & restrictions | partner portal + API | No credit data | E2E, SCN | 🟡 | — |
| §42 | Admin portal contents | admin portal + API | DB-backed metrics | E2E reports | 🟡 | — |
| §43 | RBAC, SoD, least privilege, temp access, role approvals | `rbac.ts`, guard, ROLE_ASSIGNMENT | Permission checks; super admin no financial access | SCN auth | ✅ | Access review process |
| §44 | AuthN, MFA, sessions, lockout, CSRF, 5-min customer timeout | `auth/*`, journey | — | E2E, SCN | ✅ | Enterprise IdP, WebAuthn |
| §45 | Versioned REST, OpenAPI, errors, correlation, idempotency, rate limits | API, `openapi.yaml` | Safe errors | SCN injection | ✅ | — |
| §46 | Webhooks: signing, replay protection, retries, DLQ, SSRF | `webhooks.service.ts`, `security/*` | Signed; retries; stale ignored | SEC, E2E, SCN 23 | ✅ | — |
| §47 | Developer portal (docs, explorer, samples, verifier) | `apps/developer-portal` | — | build | 🟡 | — |
| §48 | Adapter architecture & capability matrix | `packages/integrations` | Live adapters fail closed | INT | ✅ | Provider specs |
| §49 | Normalised schema, constraints, migrations, synthetic seed | `schema.prisma`, migrations, seed | Integrity constraints | E2E (append-only) | ✅ | — |
| §50 | Financial integrity & reconciliation | `runReconciliation` | Findings list (duplicates, mismatches, release w/o payment…) | manual + SCN 20 | 🟡 | Real rail statements |
| §51 | Notifications (email/SMS/in-app), no sensitive data | `notifications.service.ts`, templates | — | E2E (sandbox inbox) | 🟡 | SMS/email gateway; WhatsApp not approved |
| §52–53 | Security architecture, privacy | see SECURITY.md | — | SEC, SCN | 🟡 | KMS, AV, WAF, pentest |
| §54 | Tamper-resistant audit | hash chain + trigger | Cannot update/delete; verify | E2E audit | ✅ | SIEM/WORM |
| §55 | Exception management | `operational_exceptions`, resolution actions | Code, team, retry, escalation, history | SCN 17–19 | ✅ | — |
| §56 | Resumption with re-auth & validity checks | resume OTP, validity windows | — | SCN | ✅ | Approved validity periods |
| §57–58 | Performance, availability, observability | health/metrics, indexes, logs | — | — | 🟡 | OTel SDK, load tests |
| §59 | Management reporting, CSV exports (formula-safe) | `reports.service.ts` | DB-backed; portfolio labelled unavailable | E2E reports, SEC CSV | ✅ | Core banking (portfolio) |
| §60 | Sandbox scenarios 1–30 | `scenarios.ts`, simulators, admin forced outcomes | All reachable | E2E + SCN (see TEST_PLAN mapping) | ✅ | — |
| §62 | Future AltPay readiness | payment-method-agnostic contracts | — | — | ✅ (design) | — |
| §63–65 | Automated & security testing | test suites | Pass | all | ✅ | Playwright cross-app E2E: see TEST_PLAN |
| §66 | UAT pack | `documentation/UAT_PACK.md` | Templates; no fake sign-offs | — | ✅ | Stakeholders |
| §67 | DevSecOps & deployment | Dockerfiles, compose, CI, DEPLOYMENT.md | — | CI | ✅ | Bank pipeline |
| §68 | Production safety gates | config fail-closed, PRODUCTION_READINESS.md | Live ops locked | SCN fail-closed | ✅ | All gates |
