# Changelog

## 0.6.0 — 2026-11-27
### Changed
- Ask only what is necessary (D-036): gender only when the BVN record and the merchant both lack it; the
  credit-review form cut from 12 questions to how the customer earns and where; the answer pre-selects the
  income step. Code-delivery wording points to the BVN-linked phone again.
- New optional merchant fields `income_type`, `employer_name`, `business_name`, `nature_of_business` and
  `customer_equity_amount` skip the questions they answer.
### Added
- Live SeedFi Seed Score adapter (API v2.0) and live Periculum Insights adapter (PDF), switched on by
  `SEEDFI_MODE` / `PERICULUM_MODE` (D-035).
- Reuse of a still-valid SeedFi result across a customer's applications.
- Gender (as on the BVN record) at the identity step, including merchant pre-fill. Migration
  `20261127120000_seedfi_live`.
- Tests: adapters against the documented formats; reuse across applications.

## 0.5.0 — 2026-11-26
### Added
- Connection to the real ARAF (D-034), keeping the repositories separate:
  * `ARAF_MODE=connected` submits applications to ARAF's signed integration API instead of the
    simulator (`ArafHttpProvider`), verifies ARAF's timestamped `v1=` callback signatures, and
    reports the customer's reply to an information request (`CUSTOMER_INFORMATION_PROVIDED`).
  * Staff single sign-on with an ARAF (@altbank.ng) account: `/api/auth/admin/sso/start`, `/callback`
    and `/config`, plus a "Sign in with ARAF" button on the admin sign-in page.
  * Staff email domains are enforced for new staff and for admin password sign-in
    (`STAFF_EMAIL_DOMAINS`).
  * Config validation, environment templates and `documentation/ARAF_CONNECTION.md`.
  * Tests: connected journey against a stand-in ARAF, callback signature refusals, and the sign-in
    success and refusal paths.

## 0.4.0 — 2026-11-26
### Added
- ARAF merchant fee (D-033): 2% of the purchase amount (equity included) per processed transaction,
  per-partner rate, accrued on vendor-payment confirmation, credited on reversal/refund, monthly
  invoices (Settlement issues, Finance records payment); admin *Fees & invoices* tab; partner
  *ARAF fees & invoices*; `araf_fee` on merchant application views; migration
  `20261126190000_merchant_fee` with sign/rate CHECKs; tests.
### Changed
- Merchant-collected identity (D-032): AltMall requires date of birth and BVN for Buy Now Pay Later
  and sends them to the Bank (not stored by AltMall); the Bank checkout asks only for consent and
  the one-time code.

## 0.3.3 — 2026-11-26
### Added
- Merchant pre-fill (D-031): optional customer name, email, phone, address, date of birth and BVN on
  checkout sessions; the hosted checkout asks only for what is missing; account opening pre-filled;
  AltMall sends what it has (optional DOB/BVN); migration `20261126170000_checkout_prefill`; 2 tests.

## 0.3.2 — 2026-11-26
### Added
- Super Admin configures the partner side (D-030): admin → Partner → *Partner portal* (sections,
  checkout button style / amount, user limit, Bank support contacts), approved by a Partner
  Approving Officer; enforced in the API for every partner user; migration
  `20261126150000_partner_portal_settings`; 1 new API test.

## 0.3.1 — 2026-11-26
### Added
- araf.ng domain plan (D-029): production and sandbox environment templates, nginx reverse-proxy
  config, `TRUST_PROXY_HOPS` for real client IPs behind the proxy, and a public homepage for
  www.araf.ng ("Buy Now Pay Later with AltBank").

## 0.3.0 — 2026-11-26
### Added
- Embedded checkout (D-026): `/v1/araf.js` SDK (`ArafCheckout.open`, `ArafCheckout.button`), per-session
  `frame-ancestors` for approved partner origins, postMessage events, partitioned cookies over HTTPS;
  AltMall keeps the shopper on its own pages (no redirect) with a "Buy Now Pay Later with AltBank" CTA.
- Partner portal → Integration → *Checkout button* (preview, approved websites, copy-paste snippets);
  Bank admin → Partner → Integration → *Checkout integration*; developer portal *Embedded checkout*.
- Action-and-amount call-to-action labels across the hosted checkout (D-027).
- Safe retries (D-028): customer `Idempotency-Key` replay, client retry with the same key, offline notice,
  `documentation/FAILURE_HANDLING.md`.

## 0.2.0 — 2026-11-26
### Added
- Customer equity (D-023): "Your equity" screen in the hosted checkout; financed = price − equity,
  profit charged on the financed amount only; `POST /api/checkout/sessions/:id/equity`; merchant
  confirmation `POST /api/v1/orders/{ref}/equity`; `application.equity_confirmed` webhook; ARAF
  report `EQUITY_CONFIRMED`; equity in offers, documents, PDFs, partner/admin views; AltMall pays
  and confirms equity from the order page (demo payment).
- Per-product annual profit rate (D-024) on the partner configuration (maker-checker), snapshotted
  onto applications and offers; shown in the policy simulator, admin and partner portals.
- Business owners assessed at 10% of monthly turnover (D-025); policy simulator supports both bases.
### Changed
- Pricing is per annum (default 25% p.a.) with a hard 24-month maximum, replacing 25% / 50% total
  markup tiers. Affordability requires a completed SeedFi credit check.
- Migration `20261126090000_equity_and_product_pricing`; seed supersedes legacy policy versions.
- Tests: 199 passing (110 rules · 36 security · 7 integrations · 46 API); 200 after 0.3.0.

## 0.1.1 — 2026-11-25
### Added
- ARAF execution-status reporting (D-013): `ArafWorkflowProvider.reportStatus`, durable ordered
  delivery from `araf_outbound_reports`, retries, `ARAF_REPORTING_DELAYED` exception, admin view and
  re-queue, sandbox simulator receipt and `ARAF_REPORTING_FAILURE` forced outcome; 3 new tests.

## 0.1.0 — 2026-11-25 (sandbox build)
### Added
- Business rules package: exact kobo arithmetic, SeedScore classification, salary consolidation,
  affordability (33.3% repayment-to-income), Murabaha pricing (25% / 50% total markup), exact
  schedule reconciliation, cart comparison, goods-release gate, 13 state machines, derived statuses.
- Security package: scrypt passwords, RFC 6238 TOTP, peppered API-key hashes, AES-256-GCM field
  encryption with key ids and AAD, HMAC webhook signatures, SSRF guard with DNS pinning, masking,
  redaction, CSV formula-injection protection.
- PostgreSQL schema (~65 tables) with integrity migration (append-only audit/history/payment
  events, one live vendor payment per application, monetary CHECKs, maker ≠ checker).
- Integration adapters for 12 provider types; deterministic sandbox simulators with 20 synthetic
  identities; fail-closed live adapters; encrypted document storage.
- NestJS API: partner API v1, hosted checkout journey, partner and admin portals, ARAF workflow
  simulator, operations (documents, mandate, booking, maker-checker payment, reconciliation,
  release, fulfilment, cancellations, returns, refunds), signed webhooks with retries, reporting,
  hash-chained audit, worker with transactional outbox.
- Web apps: hosted checkout, partner portal, Bank admin portal, developer portal, AltMall demo.
- Tests: 94 business-rule, 36 security, 7 simulator, 40 API end-to-end/scenario/security tests.
- Docker images, compose stack, CI pipeline, secret scanner, demo bootstrap, documentation suite.

### Fixed (found by tests)
- See `DECISIONS.md` D-020; reopening an accepted application after the origination window.
