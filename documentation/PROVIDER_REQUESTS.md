# Provider and internal-team requests (go-live)

Pay with ARAF is built and tested in sandbox. The integrations below are simulators until real access
arrives; each live adapter fails closed (it refuses to run) until then. For each one, send the request,
then hand the documentation and sandbox credentials to engineering. Engineering builds and tests the
adapter in sandbox, then certifies it with the provider before production.

`<pwa-domain>` = the new Pay with ARAF domain once bought. Our outbound IP addresses come from the hosting
provider (Render) and are filled in when production hosting is fixed.

**Pilot scope:** AltMall only, existing AltBank customers only, low limits. That makes Mono and account
opening unnecessary at first. The pilot needs items 1 to 6; items 7 to 10 can follow.

---

## 1. BVN identity verification + SMS (Technology / Compliance)
**Why:** confirm the shopper's BVN, name and date of birth, and send the one-time code to the
BVN-linked phone. That code is what proves the shopper holds the BVN.

**Ask for:**
- API documentation for BVN lookup/verification: which fields are returned, phone number included.
- Sandbox credentials and test BVNs.
- Rate limits.
- An SMS gateway (API documentation, sender ID approval, sandbox credentials). This can be the
  Bank's existing OTP SMS provider.

**We provide:** a service account name and outbound IPs for allowlisting.

## 2. SeedFi credit assessment (Credit Risk / Technology)
**Why:** the mandatory credit check before any offer.

**Note:** ARAF already calls SeedFi's Loan Engine (Seed Score, API documentation v2.0; staging
`stg-loan-engine.theseedfi.com`, production `loanengine.theseedfi.com`).

**Ask for:**
- An API key for Pay with ARAF (separate from ARAF's, so usage and limits are tracked apart).
- Confirmation that the same Seed Score endpoint and response fields apply.
- SeedFi's go-live sign-off steps.

**Built:** the live adapter (`SEEDFI_MODE=connected`) is ready; it only needs the API key (staging first).

## 3. Periculum statement analysis (Technology / Credit Risk)
**Why:** the mandatory income and affordability analysis (6 months for salary earners, 12 months for
business owners).

**Note:** ARAF already integrates Periculum Insights (`api.insights-periculum.io`, token from
`insightsb2b.auth-periculum.app`), following Periculum's published API reference.

**Ask for:**
- API client credentials for Pay with ARAF (Settings → API Settings → API Credentials on the
  Insights dashboard).
- The webhook secret.
- Confirmation that the same statement-upload and analysis endpoints apply.
- The request body format of `POST /statements/analytics` (format `periculum`), so AltBank statements can be
  sent as transactions. Until then they must be PDFs.
- Confirmation that amounts in responses are in naira, and the scale of `confidenceOnParsing`.

**Built:** the live adapter (`PERICULUM_MODE=connected`) is ready; it only needs the credentials.

**We provide:** webhook URL `https://api.<pwa-domain>/api/webhooks/periculum` (path to be confirmed when
the adapter is built).

## 4. AltBank core banking + accounts + statements (Technology / CAD)
**Why:**
- List the customer's AltBank accounts.
- Pull 6 or 12 months of statements.
- Read existing exposure.
- Book the Murabaha financing and the repayment schedule.
- Debit repayments (pilot: from the AltBank account, instead of Remita).

**Ask for:**
- API documentation for each of those operations (or the integration layer / ESB that fronts them).
- A UAT environment with test customers.
- Service-account credentials with **limits and segregation of duties** agreed with CAD (D-013).

**We provide:** an idempotency key for every booking and debit; we never retry a booking or payment
blindly.

## 5. Vendor payment rail (Finance / Technology)
**Why:** pay the merchant after booking (NIP or internal transfer) and confirm or reverse it.

**Ask for:**
- API documentation for initiate, status query by reference, and reversal.
- The settlement account.
- UAT credentials.
- The reconciliation file format.

**We provide:** a unique payment reference per instruction. Unknown outcomes are reconciled by status
query, never re-sent.

## 6. ARAF in production (Paul / ARAF team)
**Why:** credit decisions are made in ARAF.

**Ask for:**
- Review and merge branch `claude/pay-with-araf-connection` in `pmtoje/ARAF`, then deploy.
- ARAF's production URL and which branch deploys it.
- A shared integration secret (at least 32 characters, from the secrets manager), set on both sides.
- Allow `https://admin.<pwa-domain>/api/auth/admin/sso/callback` for staff sign-in.

**We set:** `ARAF_MODE=connected`, `ARAF_BASE_URL`, `ARAF_INTEGRATION_SECRET`, `ARAF_SSO_ENABLED=true`.

**ARAF sets:**
- `PAY_WITH_ARAF_ENABLED=true`
- `PAY_WITH_ARAF_SECRET`
- `PAY_WITH_ARAF_CALLBACK_URL=https://api.<pwa-domain>/api/callbacks/araf`
- `PAY_WITH_ARAF_SSO_REDIRECT_URIS`

## 6b. Paystack — backup repayment card (Finance / Technology)
**Why:** customers link a debit card from any bank, charged only when their AltBank account is not funded.
ARAF already uses Paystack.

**Ask for:**
- Secret keys for Pay with ARAF (test, then live).
- The settlement account.
- Confirmation that recurring `charge_authorization` is enabled.
- Refund permissions for the ₦50 card check.

**Built:** `PAYSTACK_MODE=connected` uses `/transaction/initialize` (card channel), `/transaction/verify`,
`/transaction/charge_authorization` and `/refund`.

## 7. Remita direct debit (Operations / Technology), after the pilot
**Ask for:**
- Mandate API documentation, merchant ID, service type ID and API keys.
- The demo (test) environment.
- Notification/callback settings.

**Note:** Remita's authorisation pages may refuse to load inside the checkout, in which case a pop-up
is used (D-026).

## 8. Mono Connect (Technology), after the pilot, for statements from other banks
**Ask for:**
- The contract.
- Public and secret keys (sandbox, then live).
- The webhook secret.
- Products enabled (statements, identity).

## 9. Account opening platform (Digital Banking), after the pilot, for new-to-bank customers
**Ask for:**
- The start-opening API.
- The signed completion callback specification.
- A test environment.

**We provide:** callback URL `https://api.<pwa-domain>/api/callbacks/account-opening`.

## 10. Security services (Information Security / Technology)
- **Secrets manager or KMS** for encryption keys, integration secrets and API keys (today they are
  Render environment settings).
- **Malware-scanning service** for uploaded statements (API or ICAP).
- **Penetration test** booking before real money moves.
- **VPN or IP allowlist** so `admin.<pwa-domain>` is reachable only from the Bank's network.
