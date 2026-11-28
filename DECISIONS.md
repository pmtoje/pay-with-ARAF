# Architecture & product decisions (ADR log)

Each entry records context, the decision, and consequences. Entries marked **NEEDS BANK
DECISION** are proposed interpretations that must be confirmed by the named stakeholders
before production activation.

---

### D-001 — Modular monolith (NestJS) + separate worker process
**Context.** The spec recommends a modular monolith with clear domain boundaries.
**Decision.** One NestJS application (`apps/api`) with domain modules (partners, checkout,
customer journey, credit, ARAF, operations, webhooks, reports, admin). The **worker** runs the
same codebase with a different entrypoint (`dist/worker.js`) and is deployed separately.
`apps/worker` is therefore not a separate package (see README structure note).
**Consequences.** Simple deployment and transactions; services can be extracted later along the
existing module seams.

### D-002 — Transactional outbox + PostgreSQL `SKIP LOCKED` instead of BullMQ
**Context.** The spec recommends BullMQ for background jobs and also requires transactional
consistency between state changes and events.
**Decision.** Durable work (webhook fan-out, notifications, ARAF submission) is written to the
`outbox_events` table **in the same transaction** as the state change; the worker claims rows
with `FOR UPDATE SKIP LOCKED` leases. Webhook deliveries live in `webhook_deliveries` with
`nextAttemptAt` scheduling. Redis is used for rate limiting.
**Consequences.** One source of truth (Postgres), no dual-write gap, safe multi-replica workers.
BullMQ can be introduced behind `WorkerService` if throughput requires it.

### D-003 — Separate deployments per record environment
**Decision.** A deployment serves exactly one `PLATFORM_ENVIRONMENT` (SANDBOX or PRODUCTION).
Sandbox deployments only accept `sk_test_` keys and only use simulators; production
deployments only accept `sk_live_` keys and only use live adapters. Every partner-scoped row
also carries `environment` (defence in depth).
**Consequences.** Sandbox activity can never touch production records; partner master data is
provisioned per deployment.

### D-004 — Provisional brand identity — **NEEDS BANK DECISION (Brand/Marketing)**
No official brand assets were supplied. Colours (`packages/design-tokens/tokens.css`) are
documented placeholders inspired by a black/gold/white identity, and the "Pay with ARAF"
mark is a neutral product wordmark, **not** the Bank's logo. Replace with official assets.

### D-005 — Score bands (proposed) — **NEEDS BANK DECISION (Credit Risk)**
280–529 Poor (decline), 530–619 Fair (enhanced assessment), 620–800 Good (proceed). Values
outside 280–800 or non-integers are **invalid provider responses** (technical failure), not
credit outcomes. A missing score is a thin file, routed per `thinFileTreatment`
(default MANUAL_REVIEW), never coerced to 0.

### D-006 — "DSCR" terminology
The SWR's "DSCR" formula is a repayment-to-income ratio. Requirements keep the source term;
code uses `repaymentToIncomeRatio`. Maximum 33.3% (`0.333`, exact rational comparison).

### D-007 — Existing obligations source — **NEEDS BANK DECISION (Credit Risk)**
Default `MAX(bureau monthly obligations, statement recurring obligations)` (conservative).
Configurable to BUREAU or STATEMENT.

### D-008 — Exposure basis — **NEEDS BANK DECISION (Credit Risk)**
Single obligor limit ₦5,000,000 measured on `FINANCING_AMOUNT` by default (configurable to
`DEFERRED_SALE_PRICE`). Treatment of outstanding principal, pending facilities and
contingent exposure must be confirmed. Reservations are made under a row lock on the obligor.

### D-009 — Instalment rounding
Profit = round-half-up(financing × markupBps / 10 000). Regular instalment = ceil(DSP / tenor);
the **final** instalment is adjusted down so the schedule sums exactly to the deferred sale
price. This keeps the largest instalment monotonic in the financing amount, which makes the
affordability search exact. (A remainder-absorbing *larger* final instalment was rejected
because it breaks monotonicity — found by the spec-example test.)

### D-010 — Partial financing disabled by default — **NEEDS BANK DECISION (Business, Legal, Shariah)**
Implemented end-to-end (contribution amount, release gate requires contribution verification)
but disabled at both policy and partner level. Contribution collection rails are not built.

### D-011 — Contractual sequence (Murabaha) — **NEEDS BANK DECISION (Shariah governance, Legal, Credit Risk)**
**Conflict.** The spec's ARAF route places *booking* before *vendor payment*; a classical
Murabaha requires the Bank to acquire the asset before the sale to the customer (and arguably
before booking the receivable).
**Proposed sandbox sequence.** Approval → documentation (promise to purchase / wa'd, offer
letter; customer e-signs with OTP) → repayment mandate → booking (`BOOKING_BEFORE_VENDOR_PAYMENT
= true`) → vendor payment (Bank acquires asset; invoice in the Bank's name) → CAD records
ownership/constructive possession → customer executes the Murabaha **sale agreement** (cost and
profit disclosed) → **release authorised**. The release gate requires all six conditions
(`PRE_RELEASE_CONDITIONS`). The sale contract cannot be executed before acquisition is evidenced.
The booking position is a single flag pending Shariah ruling.

### D-012 — ARAF remains authoritative; simulator only in sandbox
No ARAF API was supplied. `ArafWorkflowProvider` defines idempotent submission + lookup by
idempotency key + authenticated status events (`POST /api/callbacks/araf`, HMAC). The sandbox
simulator (staff-operated, maker-checker on approval) emits the same events. The proposed
stage list is **not** the Bank's approval hierarchy, which must be inherited from ARAF.

### D-013 — Booking & vendor-payment execution ownership — **DECIDED (2026-11-25, product owner)**
**Decision.** Pay with ARAF executes financing booking (core banking) and vendor payment itself,
through its adapters. ARAF remains the authoritative source of the *approval*; Pay with ARAF
executes only after the ARAF approval event and all preconditions are satisfied.
**Controls that follow from this ownership** (already implemented): CAD verifies the vendor
invoice and requests booking (`booking.execute`); booking is idempotent and reconciled before any
retry; settlement creates the payment instruction (maker) and finance approves it (checker,
enforced in service and database); one live instruction per application; payment timeouts become
UNKNOWN and are reconciled, never re-initiated; release only via the release gate.
**Consequences.** Pay with ARAF must be onboarded to the core banking booking API and the payment
rail as an authorised originating system: service accounts, transaction limits, segregation of
duties, Finance and CAD operating procedures, and daily reconciliation with core banking and rail
statements become production gates (see PRODUCTION_READINESS.md).
**Reporting back to ARAF (implemented).** `ArafWorkflowProvider.reportStatus` sends execution
outcomes — BOOKING_CONFIRMED/FAILED, VENDOR_PAYMENT_INITIATED/CONFIRMED/FAILED/REVERSED,
RELEASE_AUTHORIZED/SUSPENDED, GOODS_DISPATCHED/DELIVERED, REFUND_INITIATED/COMPLETED,
APPLICATION_CANCELLED. Reports are written to `araf_outbound_reports` in the same transaction as
the change, delivered by the worker strictly in per-application sequence, idempotent on the event
id, retried with backoff; after 5 failed attempts an `ARAF_REPORTING_DELAYED` operations exception
is raised (auto-resolved on delivery; manual re-queue available). A reporting outage never blocks
or reverses the financial operation. The sandbox simulator records reports in the case history.
The live wire format is **not** invented: the live adapter fails closed until the ARAF team agrees
the event contract (payload, transport, authentication).

### D-014 — Live adapters fail closed
Without contracted specifications we do not invent endpoint formats. Every live adapter throws
`IntegrationNotConfiguredError`; production config refuses `LIVE_OPERATIONS_ENABLED` outside
`APP_ENV=production`; no code path serves a PRODUCTION record with a simulator.

### D-015 — API keys hashed with a pepper; webhook secrets encrypted
API secrets: HMAC-SHA256 with a server pepper, shown once, 16-char lookup prefix. Webhook
signing secrets must be recoverable to sign, so they are AES-256-GCM encrypted with AAD bound to
the endpoint id. Rotation keeps the previous secret signing for 24 h.

### D-016 — Field encryption with AAD binding
Sensitive fields (BVN, DOB, phone, account numbers, statement data, review forms, TOTP
secrets) use AES-256-GCM with key ids (rotation) and associated data binding the ciphertext to
its owner (e.g. `analysis:<applicationId>`), so ciphertexts cannot be swapped between records.
Copying data between applications requires explicit re-encryption (found by tests, D-020).

### D-017 — Customer authentication model
Possession of the checkout URL grants nothing personal. The customer is authenticated by an
OTP sent to the **phone linked to the BVN record** (never a checkout-entered phone). One active
browser session per application; 5-minute inactivity → re-authentication with a resume OTP;
OTPs are 6 digits, 5-minute TTL, single use, bound to challenge id and browser session, 5
attempts, 60 s resend cooldown, invalidated by newer challenges.

### D-018 — Staff & partner MFA: TOTP (RFC 6238) with replay protection
Mandatory for every portal user. Phishing-resistant MFA (WebAuthn) and enterprise SSO (Bank IdP)
are recommended for production privileged users (PRODUCTION_READINESS).

### D-019 — Sandbox API credentials issued on first use
On approval the partner is provisioned (configuration, dashboard, admin invitation, webhook
signing profile). The partner admin generates the first sandbox key in the portal so the secret
is only ever displayed to the partner, never stored or shown to Bank staff.

### D-020 — Bugs found and fixed by the automated suites (selected)
* Affordability bound non-monotonic with remainder-heavy final instalment (D-009).
* `BigInt.prototype.toJSON` patch defeated serialisation replacers → kobo stored as floats;
  replaced by an HTTP response interceptor.
* `jsonb` reorders keys → audit hash chain verification failed; now canonical JSON.
* Zod errors from a separate module instance surfaced as 500; now duck-typed → 422.
* Reused assessments for revised carts were not re-evaluated / not re-encrypted.

### D-021 — Test database isolation is non-destructive
Each test run creates a new uniquely named database and applies `prisma migrate deploy`.
Nothing is ever reset or dropped by the suites.

### D-022 — Product images
The demo storefront uses original inline SVG illustrations (no third-party images, logos or
brand names) to avoid licensing issues.

### D-023 — Customer equity reduces the financed base (PROPOSED)
Requested by the business owner of this build (2026-11-26). The customer may pay equity to the
merchant; the Bank finances `purchase − equity` and charges profit only on that amount. Equity is
paid after approval and must be confirmed by the merchant before the Bank pays the vendor. The
Bank's disclosed acquisition cost in the documents is the financed amount, with the purchase price
and equity shown alongside. **Open:** Shariah, Legal and Credit Risk sign-off of the equity
structure (e.g. whether the Bank should acquire the whole asset with the customer's equity applied
as part-payment), merchant refund obligations if a confirmed-equity application is later cancelled,
and any minimum equity percentage. Not an approved policy.

### D-024 — Profit priced per annum, per product; 24-month cap (PROPOSED)
Replaces the earlier 25% / 50% total-markup tiers. Each partner product has its own maker-checker
approved annual rate (AltMall 25% p.a.); total markup = rate × tenor ÷ 12. The 24-month maximum is
enforced by the policy schema, partner configuration validation and pricing functions. Earlier
policy versions are read as their per-annum equivalent so in-flight applications stay readable;
accepted offers keep the amounts priced at the time. Rates remain PROPOSED until Credit Risk /
Shariah approve them.

### D-026 — Embedded checkout: shoppers start and end on the merchant's website
Requested 2026-11-26. Merchants load `/v1/araf.js` from the Bank's checkout origin and open the
hosted checkout in a sandboxed iframe panel on their own page (`ArafCheckout.open`). Framing is
allowed only for the partner's approved origins (per-session CSP `frame-ancestors`); the iframe
cannot navigate the merchant page; postMessage events carry status only and are verified by
origin and source; over HTTPS the customer cookie is `SameSite=None; Secure; Partitioned` (CHIPS).
Merchant returns become "close panel" instead of navigation. The payment-screen call to action is
**"Buy Now Pay Later with AltBank"**. Integration setup lives in the Partner portal (self-service:
button, snippets, approved websites); the Bank admin portal shows each partner's integration and
controls which websites are approved (maker-checker). **Production note:** real Remita/Mono pages
may refuse framing — their live adapters must open in a pop-up and return to the panel.

### D-027 — Every button states the action (and amount)
Primary calls to action say exactly what happens, with the amount where there is one (e.g.
"Accept ₦93,750.00/month × 6 and submit to the Bank", "Authorise ₦93,750.00 monthly direct debit
with Remita", "Sign and buy for ₦562,500.00", "Pay ₦145,000.00 equity at AltMall").

### D-028 — Safe retries on slow networks
Customer writes are idempotent (`Idempotency-Key`, Redis replay for 24 h, scoped to the browser
session) and retried with the same key; on uncertainty the UI re-reads server state. See
`documentation/FAILURE_HANDLING.md`.

### D-029 — Public domain: araf.ng
Requested 2026-11-26. `www.araf.ng` is the customer-facing home: public homepage, hosted checkout
and the embed SDK (`https://www.araf.ng/v1/araf.js`), so the address customers verify is the brand
domain. Partner API on `api.araf.ng`, portals on `partners.` / `developers.`, admin on an internal-only
`admin.araf.ng`; sandbox under `*.sandbox.araf.ng`. Host-only cookies per sub-domain (no shared
cookie domain). See DEPLOYMENT.md → Domains. **Open:** domain registration under the Bank's name and
the hosting platform choice (Technology).

### D-030 — The partner side is configured by the Super Admin (maker-checker)
Requested 2026-11-26. For each partner the Super Administrator sets what the partner sees on
partners.araf.ng: which sections are available (applications, ready for release, settlements,
integration, team, report exports — dashboard and security always on), the checkout button style
and whether it shows the amount (the wording "Buy Now Pay Later with AltBank" is fixed), the maximum
number of portal users, and the Bank support contacts shown to the partner. The Super Admin is the
**maker** (new permission `partner.portal.configure`, plus partner set-up: create, vendors, production
request); a Partner Approving Officer is the **checker** (approval type `PARTNER_PORTAL`). A section
switched off is removed from every partner user's effective permissions, so it disappears from the
menu and its API calls are refused. The Super Admin still cannot approve partners, credit or payments
and has no access to customer financial data. All changes are audited.

### D-031 — Pre-fill what the merchant already collected; ask only for the rest
Requested 2026-11-26. `POST /checkout/sessions` accepts optional `customer` details (first/last name,
email, phone, address, date of birth, BVN). They are encrypted at rest (AAD bound to the session),
copied to revised sessions, never returned to the merchant, never logged or placed in URLs. The
hosted checkout shows which details were provided (BVN: last two digits only — values are never
sent to the browser before OTP) and asks only for the missing ones; the customer can replace any
pre-filled value, and a mismatch falls back to manual entry. Contact details and address pre-fill
account opening. Explicit consent and the OTP to the BVN-linked phone are always required — they
cannot be pre-filled. **Open:** Compliance to confirm which partners may send BVN (e.g. KYC-regulated
partners only) and whether that needs a partner-level permission.

### D-032 — The merchant collects the customer's details; the Bank runs the checks
Requested 2026-11-26: "Let AltMall do it and send it to us so we can run a check on it." For Buy Now
Pay Later the merchant collects name, contact details, address, date of birth and BVN and sends them
server-to-server when creating the checkout session (AltMall makes date of birth and BVN required and
does not store them). The Bank's checkout then asks only for what is still missing. The Bank still
obtains, in its own checkout: the customer's **explicit consents** (the Bank is the data controller
for the credit check and statement analysis) and the **one-time code** to the BVN-linked phone
(proof the customer is the BVN holder). If merchant details do not match, the customer may correct
them. **Open:** Compliance to confirm partner eligibility to collect BVN and whether consent can be
captured by the merchant on the Bank's behalf (would need versioned Bank wording + evidence).

### D-033 — ARAF merchant fee: 2% of the amount applied for, invoiced separately
Requested 2026-11-26. ARAF charges the merchant 2% of the purchase amount (equity included) on every
transaction processed (vendor payment confirmed). Chosen settlement: **invoiced monthly**, not
deducted from the vendor payment and not charged to the customer. Rate is per partner configuration
(default 2%, maker-checker). Reversed payments and refunds generate credits. **Open:** VAT treatment,
payment terms and collection process (Finance), contractual basis in partner agreements (Legal).

### D-034 — Connect to the real ARAF; the repositories stay separate
Requested 2026-11-26: "Use the repository from the ARAF Check out on Paul's git hub"; chosen: **only
connect, keep repos apart**. ARAF (the AltBank Retail Asset Factory, @altbank.ng sign-in) stays its
own application and database. The two are joined by a signed HTTP contract (v1, HMAC-SHA256 over
`timestamp.METHOD.path.body`, 300-second window, one shared secret from the secrets manager):
* `ARAF_MODE=connected` replaces the built-in simulator. Applications are submitted to ARAF's
  integration API (idempotent, looked up by key after a timeout). Credit staff decide them in ARAF
  (credit officers evaluate; a Credit Lead or the Unit Head approves; the recommender cannot
  approve). Decisions come back as signed callbacks, delivered in order. Execution steps and the
  customer's reply to an information request are reported to ARAF.
* `ARAF_SSO_ENABLED=true` lets Bank staff sign in to the admin portal with their ARAF account. ARAF
  only vouches for who the person is (its email OTP is the second factor). Roles and permissions
  stay in Pay with ARAF, and the person must already hold an active staff account here (no
  automatic provisioning). Staff emails are limited to `STAFF_EMAIL_DOMAINS` (altbank.ng in
  production).
**Open:** ARAF's production host and which branch deploys it; whether password + TOTP sign-in
should be switched off for Bank staff once single sign-on is live; secret rotation procedure.

### D-035 — Live SeedFi and Periculum; each customer is analysed once while the result is valid
Requested 2026-11-27: "Need Seedfi and Periculum to analyze the customer once and for all."
* **SeedFi** (`SEEDFI_MODE=connected`) follows SeedFi API v2.0 — the contract the Bank's ARAF already uses.
  - The decision uses the reviewed Seed Score, rounded **down** to a whole number.
  - "No credit history" means no score, so the thin-file policy applies.
  - Production refuses SeedFi test (dummy) responses. Any unexpected answer is a technical failure, never a pass.
  - SeedFi requires the BVN-linked phone and the gender on the BVN record. Gender is taken from the BVN service
    when it returns one, otherwise from the merchant pre-fill, otherwise asked at the identity step.
* **Periculum** (`PERICULUM_MODE=connected`) follows Periculum's published API: PDF statement upload, then the
  documented analytics and transactions.
  - **Salary:** the credits Periculum lists in `incomeAnalysis.salaryTransactions` (matched by date and amount).
    The Bank's salary rules then apply.
  - **Existing obligations:** `behavioralAnalysis.averageMonthlyLoanRepaymentAmount`.
  - **Reliability:** a statement counts as reliable only when Periculum reports a parsing confidence ≥ 90%.
    Otherwise a missing salary month goes to review, never to an automatic decline.
  - **PDF only for now:** AltBank and Mono statements (transaction lists) are refused until Periculum confirms its
    JSON analytics format. **Open:** confirm that format, or have core banking supply official PDF statements.
  - **Assumption to confirm:** amounts in Periculum responses are naira.
* **Once and for all:** a customer's still-valid SeedFi result (same environment) is reused by their next
  application instead of calling SeedFi again. It keeps its original expiry and is re-classified under the new
  application's credit policy. Within one application, revised carts already reuse statements and analysis.

### D-036 — Ask only what is necessary
Requested 2026-11-27: "if the detail isn't necessary, please don't ask for it."
* **Gender** (needed by SeedFi) comes from the BVN record or the merchant pre-fill. The customer is asked only
  when both are missing, and the server says so.
* **Fair-credit / no-history review form:** cut from 12 questions to how the customer earns (salary or own
  business), the employer or business name, and optionally what the business does and for how long.
  - Income and existing repayments come from SeedFi and the statement analysis; the address from the merchant
    or the BVN record.
  - Accommodation type, number of dependants and job title were not used by any rule and are no longer asked.
  - The answer pre-selects the later "How do you earn?" step (salary earner or business owner), so it is not
    asked twice.
* **Business owners** use the same checkout: 12 months of statements, all repayments ≤ 10% of average monthly
  turnover (D-025), and Periculum's BUSINESS statement type.
* **Credit Risk** may ask for any removed question to come back; the API still accepts the old fields.
* **Take what the merchant passes; ask only what remains.** Merchants may also send `income_type`,
  `employer_name` / `business_name` / `nature_of_business` and `customer_equity_amount`:
  - With `income_type` (plus the employer or business name where needed), the eligibility form and the
    "How do you earn?" step are skipped.
  - The agreed equity is used without asking again, if it is within the allowed range; the customer can still
    change it.
  - Choosing the repayment account is kept, because the customer must confirm which account is debited. A single
    eligible account is pre-selected.
* **Customer wording never describes the Bank's internal process** (credit officers, manual review, credit
  reports, analysts): the customer sees that the application is being checked. Exception: the consent texts
  still name SeedFi and Periculum, because data-protection rules require third-party processors to be disclosed
  before consent.

### D-037 — Backup repayment card from any bank (Paystack)
Requested 2026-11-28: "For repayments, we need to be able to connect other accounts by the debit card". Chosen:
every customer still has an **Alternative Bank account** (booking and the primary direct debit), and adds a
**debit card from any bank as a backup**, charged only when the AltBank account is not funded. Provider:
**Paystack**, the provider ARAF already uses.
* **Linking**, during repayment set-up:
  - A ₦50 card check (`CARD_CHECK_AMOUNT_KOBO`) is charged and refunded immediately.
  - Paystack's `authorization_code` is saved, encrypted, only if Paystack says it is reusable and the channel
    is `card`.
  - The card is verified with Paystack, never from the redirect. A worker finishes links whose redirect never
    came back.
  - Repayment set-up moves on to booking only when the direct-debit mandate is active **and** a backup card is
    linked (`BACKUP_CARD_REQUIRED=true`).
  - The card's signature is stored only as a hash (to spot one card shared across customers).
* **Charging**, maker-checker:
  - A Settlement Officer (`payment.initiate`) proposes a charge with a reason, capped at the deferred sale price
    minus what has already been charged.
  - A Finance Officer (`payment.approve`), never the proposer, approves it in the Approvals inbox.
  - The card is then charged once under a fixed reference. An unknown outcome is reconciled with Paystack by that
    reference and never charged again blindly.
* **Not built here:** deciding *when* an instalment is missed (the core-banking repayment schedule). Staff raise
  the charge today; automation can follow once core banking reports failed debits.
* **Keys:** Pay with ARAF uses **ARAF's Paystack account and secret key** (decided 2026-11-28). Every
  Pay with ARAF transaction carries `metadata.source = "pay-with-araf"` and the application reference, so the two
  products are easy to separate in the Paystack dashboard and in reconciliation. The key is set as
  `PAYSTACK_SECRET_KEY` from the secrets manager on each deployment, never committed.
* **Open:**
  - Card-on-file and recurring-debit consent wording (Compliance).
  - Whether the ₦50 check can be waived for cards the customer already linked.

### D-025 — Business owners: 10% of turnover, assessed automatically (PROPOSED)
Business owners are now assessed by the engine: existing obligations plus the proposed instalment
may not exceed 10% of average monthly turnover from the 12-month Periculum analysis. Unreliable
statements or unverified turnover still go to manual review. Affordability is never computed
without a completed SeedFi credit check. Values are PROPOSED, not approved policy.
