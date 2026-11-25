# Architecture

## 1. System context

```mermaid
flowchart LR
  subgraph Merchants
    M[Merchant website / AltMall]:::ext
  end
  C((Customer)):::actor
  subgraph PayWithARAF[Pay with ARAF]
    CO[Hosted checkout\nNext.js :3001]
    PP[Partner portal\nNext.js :3002]
    AP[Bank admin portal\nNext.js :3003]
    DP[Developer portal\nNext.js :3004]
    API[API — NestJS modular monolith :4000]
    WK[Worker — outbox, webhooks, pollers]
    DB[(PostgreSQL)]
    R[(Redis — rate limits)]
    S[(Encrypted document storage)]
  end
  subgraph External[Bank & third-party systems — adapters]
    IDV[BVN identity]:::ext
    SF[SeedFi]:::ext
    ALT[AltBank accounts / core banking]:::ext
    AO[Account opening]:::ext
    MONO[Mono]:::ext
    PCL[Periculum]:::ext
    ARAF[Existing ARAF workflow]:::ext
    REM[Remita]:::ext
    PAY[Payment rail]:::ext
  end
  M -- "POST /api/v1/checkout/sessions (sk_ key)" --> API
  M -- redirect --> CO
  C --> CO
  CO & PP & AP & DP -- "/api same-origin proxy" --> API
  API --> DB & R & S
  WK --> DB
  WK -- "signed webhooks" --> M
  API & WK --> IDV & SF & ALT & AO & MONO & PCL & ARAF & REM & PAY
  ARAF -- "HMAC status events" --> API
  classDef ext fill:#f6efd9,stroke:#b08a2e;
  classDef actor fill:#fff,stroke:#333;
```

AltMall integrates exactly like any external merchant (public API + signed webhooks) and has its
own database; it has no access to the financing database.

## 2. Monorepo

| Path | Purpose |
| --- | --- |
| `apps/api` | NestJS API (HTTP entry `main.ts`) and worker (entry `worker.ts`, same codebase) |
| `apps/customer-checkout` | Hosted, mobile-first financing journey + sandbox provider stand-in pages |
| `apps/partner-portal` | Merchant dashboard |
| `apps/admin-portal` | Bank administration, credit review, ARAF simulator, operations |
| `apps/developer-portal` | Docs, API explorer, webhook verifier |
| `apps/altmall-demo` | Demonstration storefront (external merchant) |
| `packages/business-rules` | Pure deterministic financial rules + state machines |
| `packages/security` | Crypto, keys, OTP/TOTP, webhook signatures, SSRF guard, privacy helpers |
| `packages/database` | Prisma schema, migrations, seed |
| `packages/integrations` | Adapter interfaces, sandbox simulators, fail-closed live adapters, storage |
| `packages/types` | RBAC catalogue, webhook events, error catalogue, public request schemas |
| `packages/ui`, `packages/design-tokens` | Design system |

## 3. API modules

```mermaid
flowchart TB
  auth[auth\nportal sessions, MFA, API keys, customer sessions]
  partners[partners\nonboarding, config, vendors, credentials, webhooks]
  approvals[approvals\ngeneric maker-checker]
  checkout[checkout\npartner API v1]
  journey[customer journey\nidentity, OTP, credit, accounts]
  statements[statements\nAltBank, Mono, PDF → Periculum]
  credit[credit\neligibility, offers, reviews, policy]
  araf[araf\nsubmission, events, simulator]
  ops[operations\ndocs, mandate, booking, payment,\nrelease, fulfilment, refunds, reconciliation]
  webhooks[webhooks\nevents, signed delivery]
  reports[reports]
  admin[admin]
  common[common\naudit chain, outbox, state, idempotency,\nrate limit, crypto, providers]
  checkout --> journey --> statements --> credit --> araf --> ops
  partners & checkout & journey & credit & araf & ops --> approvals
  ops & journey & checkout --> webhooks
  all[every module] --> common
```

Cross-cutting guarantees:
* **Global deny-by-default guard** — every route must declare `@Public`, `@Staff(perm…)`,
  `@PartnerUser(perm…)`, `@ApiKey(scope)` or `@Customer()`; undecorated routes are refused.
* **Tenant scoping** — partner-facing queries always filter by `partnerId` from the credential or
  session (never from request input) **and** `environment`.
* **State transitions** — `StateService.transitionApplication` validates against the state machine,
  uses optimistic concurrency (`version`), writes immutable history and an outbox event in the
  same transaction. Critical sections additionally `SELECT … FOR UPDATE` the application row.
* **Audit** — `AuditService` appends hash-chained records (canonical JSON, advisory-lock
  serialised); a DB trigger makes `audit_logs`, state history and payment events append-only.

## 4. End-to-end lifecycle

```mermaid
sequenceDiagram
  autonumber
  participant Shop as Merchant
  participant API as Pay with ARAF API
  participant Cx as Customer (hosted checkout)
  participant P as Providers (sandbox sims)
  participant ARAF as ARAF workflow
  participant Ops as Bank staff
  Shop->>API: POST /v1/checkout/sessions (Idempotency-Key)
  API-->>Shop: checkout_url · webhook application.created
  Cx->>API: consents, BVN + DOB
  API->>P: BVN lookup → OTP to BVN-linked phone
  Cx->>API: OTP → SeedFi assessment (poor/fair/good/thin)
  Cx->>API: select / open AltBank account (signed state + callback)
  Cx->>API: statement (AltBank / Mono / PDF) → Periculum job
  API->>API: salary rules, affordability, exposure reservation (row lock)
  Cx->>API: choose tenor, accept indicative offer
  API->>ARAF: idempotent submission (lookup before retry)
  ARAF-->>API: HMAC events (under review → approved)
  Cx->>API: sign promise to purchase (OTP) · authorise Remita mandate
  Ops->>API: CAD verifies invoice, books financing
  Ops->>API: settlement creates payment instruction · finance approves (maker-checker)
  API->>P: initiate payment (timeout ⇒ UNKNOWN ⇒ reconcile)
  P-->>API: CONFIRMED (authoritative) → asset acquired
  Ops->>API: CAD records possession evidence → sale agreement issued
  Cx->>API: execute Murabaha sale (OTP)
  API->>API: release gate (locked) → REL-… authorised
  API-->>Shop: signed goods.release_authorized
  Shop->>API: GET /v1/releases/REL-… (verify) · fulfil · deliver
```

## 5. Data model (key entities)

Identity & access: `users`, `roles`, `permissions`, `user_roles`, `sessions`, `mfa_credentials`,
`user_invitations`, `approval_requests`. Partners: `partners`, `partner_configurations` (versioned),
`partner_domains`, `partner_api_credentials`, `partner_webhook_endpoints`, `vendors`,
`vendor_settlement_accounts`. Journey: `customers`, `customer_accounts`, `customer_consents`,
`checkout_sessions`, `customer_sessions`, `merchant_orders`, `order_items`,
`financing_applications`, `application_state_history`, `identity_verifications`, `otp_challenges`.
Credit: `credit_policies`, `credit_policy_versions`, `credit_assessments`, `enhanced_reviews`,
`review_decisions`, `affordability_assessments`, `exposure_reservations`. Statements:
`account_opening_requests`, `stored_documents`, `statement_connections`,
`statement_analysis_jobs`, `statement_analysis_results`. Offers: `financing_offers`,
`repayment_schedules`, `offer_acceptances`. ARAF & ops: `araf_submissions`, `araf_status_events`,
`contractual_conditions`, `financing_documents`, `repayment_mandates`, `booking_records`,
`vendor_payment_instructions`, `vendor_payment_events`, `reconciliation_runs`,
`payment_reconciliations`, `release_authorizations`, `fulfilment_records`,
`cancellation_requests`, `return_requests`, `refund_records`. Platform: `outbox_events`,
`webhook_events`, `webhook_deliveries`, `webhook_delivery_attempts`, `idempotency_records`,
`notifications`, `notification_templates`, `audit_logs`, `integration_logs`, `api_request_logs`,
`operational_exceptions`, `reference_sequences`. Sandbox-only: `sim_araf_cases`,
`sim_araf_actions`, `sim_records`, `sandbox_messages`.

Integrity controls (migration `integrity_controls`): append-only triggers; one live vendor payment
per application (partial unique index); one accepted offer per application; one active policy and
partner configuration; CHECK constraints for amounts (incl. `financing + contribution = purchase`,
`DSP = financing + profit`, `line = unit × qty`); maker ≠ checker CHECKs.

## 6. Data flows & classification

| Class | Examples | Controls |
| --- | --- | --- |
| Restricted | BVN, DOB, phone, account numbers, statements, salary credits, review forms, TOTP secrets | AES-256-GCM + AAD, blind index for BVN lookup, masked display, never logged, sensitive-permission gated, access audited |
| Confidential | Scores, affordability, decisions, payment details | Bank roles only; never in partner views or webhooks |
| Internal | Application status, references, amounts | Tenant-scoped |
| Secret | API keys (hashed), webhook secrets (encrypted), session tokens (hashed), OTPs (HMAC) | Shown once / never stored in plaintext |

## 7. Deployment topology
Stateless API replicas behind the Bank's API gateway/WAF; ≥ 2 worker replicas (SKIP LOCKED);
managed PostgreSQL with PITR; Redis; S3-compatible encrypted object storage; KMS/HSM-managed data
keys; OpenTelemetry collector. See `DEPLOYMENT.md`.

## 8. Future AltPay integration
Pay with ARAF exposes a payment-method-agnostic contract (checkout session → hosted journey →
status API → events). AltPay can list "Pay with ARAF" as a payment method by creating checkout
sessions on the merchant's behalf and relaying events; the financing engine is unchanged.
