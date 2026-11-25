# Integration guide

## Part A — Merchants

1. **Onboarding.** The Bank onboards you (maker-checker). You receive an invitation to the
   Partner portal, enrol MFA, and generate a **sandbox secret key** (`sk_test_…`, shown once).
   Store it in your server secrets; never in browsers or mobile apps.
2. **Webhook endpoint.** In *Integration → Webhooks* add your HTTPS endpoint and store the
   signing secret (`whsec_…`). Subscribe to all events or a subset.
3. **Checkout.** When the shopper chooses *Pay with ARAF*, your **server** calls
   `POST /api/v1/checkout/sessions` with the cart snapshot (integer kobo, single approved vendor,
   approved `return_url` / `cancel_url` origins) and an `Idempotency-Key` derived from your order
   reference. Redirect the shopper to `checkout_url`.
4. **Return.** The shopper returns to `return_url` or `cancel_url`. **A redirect is not proof of
   anything.** Show "confirming status" and query `GET /api/v1/orders/{ref}`.
5. **Webhooks.** Verify `ARAF-Signature` over the raw body (constant-time, 300 s tolerance),
   de-duplicate by `event_id`, ignore stale `resource_version`, respond 2xx quickly.
6. **Release goods only** after `goods.release_authorized` **and** `GET /api/v1/releases/{ref}`
   returns `release_authorized: true` with status `AUTHORIZED`. Eligibility, approval, booking and
   payment initiation are **not** release authorisations. If you receive `goods.release_suspended`,
   stop.
7. **Fulfil.** `POST /orders/{ref}/fulfil {status:"DISPATCHED", tracking_reference, carrier}`, then
   `POST /orders/{ref}/deliver`. Duplicates are rejected.
8. **Changes.** Cancel before payment with `/cancel`; after a payment instruction exists the same call
   opens a controlled reversal. Returns via `/return`. Refunds flow vendor → Bank, never to the
   customer's account.
9. **Cart changes.** If the customer is eligible for less than the cart, they return to you; create
   a new session for the same order with `revises_session_id`.

Reference implementation: `apps/altmall-demo` (server-side session creation, raw-body webhook
verification, idempotent processing, release verification, vendor console).

Sandbox test identities: Developer portal → *Sandbox testing*, or
`packages/integrations/src/sandbox/scenarios.ts`.

## Part B — Bank integrations (provider adapters)

Interfaces: `packages/integrations/src/interfaces.ts`. To go live with a provider:

1. Obtain the contracted API specification, credentials, network access and test environment.
2. Implement the adapter in `packages/integrations/src/live/` behind the existing interface:
   request/response validation (zod), authentication, timeouts, retry policy **only for idempotent
   operations**, error normalisation to `ProviderError`, correlation ids.
3. Map only fields the contracted API actually provides; update the capability matrix
   (`PROVIDER_CAPABILITY_MATRIX`).
4. Contract tests against the provider sandbox; certify; record in `PRODUCTION_READINESS.md`.
5. Enable in the production deployment only after all gates are signed off.

| Interface | Provider | Notes |
| --- | --- | --- |
| IdentityVerificationProvider | BVN service (NIBSS / Bank) | Must return the BVN-linked phone for OTP |
| CreditAssessmentProvider | SeedFi | Raw score validated by the Bank's policy engine |
| BankAccountProvider / CoreBankingProvider | AltBank internal | Accounts by BVN, name enquiry, statements, exposure, idempotent booking + query |
| AccountOpeningProvider | AltBank account opening | Signed callback + authoritative result lookup |
| StatementAcquisitionProvider | Mono | Code exchange server-side; no banking passwords |
| StatementAnalysisProvider | Periculum | Async jobs; provider data never overrides Bank policy |
| ArafWorkflowProvider | Existing ARAF | Idempotent submit + lookup by key; HMAC/mTLS status events |
| RepaymentMandateProvider | Remita | Authoritative status verification |
| VendorPaymentProvider | Bank payment rail | Idempotent initiation; status query; refunds |
| NotificationProvider | Bank SMS/email | Templates without sensitive data |
| MalwareScanner | Bank AV | Fail closed |
