# Connecting Pay with ARAF to the real ARAF

ARAF (the AltBank Retail Asset Factory) is the Bank's internal credit workflow application. It has its
own repository, database and @altbank.ng email-OTP sign-in. Pay with ARAF stays a separate
application. The two talk over a small signed HTTP contract (D-034). The ARAF side is documented in
ARAF's `docs/PAY-WITH-ARAF.md`.

## What the connection does

| Direction | What | When |
|---|---|---|
| Pay with ARAF → ARAF | Submit an application (checks, affordability, offer, schedule, consents) | Customer accepts the offer |
| Pay with ARAF → ARAF | Look up a submission by idempotency key | After a timeout, before any retry |
| ARAF → Pay with ARAF | Signed decision callbacks: `UNDER_REVIEW`, `INFO_REQUESTED`, `INFO_PROVIDED`, `APPROVED`, `REJECTED` | Credit staff act in ARAF |
| Pay with ARAF → ARAF | Execution reports: customer reply, booking, vendor payment, release, delivery, refunds | As each step happens |
| Browser → ARAF → Pay with ARAF | Staff sign-in to the admin portal with an ARAF account | "Sign in with ARAF (@altbank.ng)" |

## Settings

| Pay with ARAF | ARAF | Notes |
|---|---|---|
| `ARAF_MODE=connected` | `PAY_WITH_ARAF_ENABLED=true` | `simulator` keeps the built-in sandbox workflow. |
| `ARAF_BASE_URL` | — | ARAF's URL; https in production. |
| `ARAF_INTEGRATION_SECRET` | `PAY_WITH_ARAF_SECRET` | The same value, at least 32 characters, from the secrets manager. |
| — | `PAY_WITH_ARAF_CALLBACK_URL` | `https://<api host>/api/callbacks/araf` |
| `ARAF_SSO_ENABLED=true` | `PAY_WITH_ARAF_SSO_REDIRECT_URIS` | `https://<admin portal>/api/auth/admin/sso/callback` |
| `STAFF_EMAIL_DOMAINS` | `STAFF_EMAIL_DOMAIN` | `altbank.ng` in production (example domains are refused). |

Pay with ARAF refuses to start in these cases:

* `ARAF_MODE=connected` or `ARAF_SSO_ENABLED=true` is set without both the URL and the secret.
* In production, `ARAF_BASE_URL` is not https.
* In production, `STAFF_EMAIL_DOMAINS` includes an example domain.

## Signing (contract v1)

```
X-PWA-Signature  = "v1=" + hex(HMAC-SHA256(secret, `${t}.${METHOD}.${path}.${body}`))   (to ARAF)
X-ARAF-Signature = "v1=" + hex(HMAC-SHA256(secret, `${t}.POST./api/callbacks/araf.${body}`)) (to us)
```

* `t` is Unix seconds, sent as `X-PWA-Timestamp` or `X-ARAF-Timestamp`. Anything more than 300 seconds
  out is refused.
* In connected mode the simulator's signature (`INTERNAL_CALLBACK_SECRET`) is not accepted on
  `/api/callbacks/araf`.

## Failure handling

* **Submission timeout:** the outcome is unknown. Pay with ARAF asks ARAF by idempotency key before
  any retry, so an application is never submitted twice. The customer sees "submitted" only after ARAF
  acknowledges.
* **Callbacks:**
  * ARAF retries with backoff and delivers each case's callbacks in order.
  * Pay with ARAF de-duplicates by `event_id` and ignores stale sequences.
  * After 10 failed attempts ARAF notifies its Super Admins, who can send the update again from the case.
* **Execution reports:** Pay with ARAF's outbox retries in order. ARAF de-duplicates by `eventId`.
* **ARAF unavailable:** applications wait in `ARAF_SUBMISSION_PENDING` and are retried by the worker.
  Nothing is approved without ARAF.

## Staff sign-in

1. `GET /api/auth/admin/sso/start` sets a short-lived state cookie and redirects to
   `{ARAF}/sso/pay-with-araf?redirect_uri&state`.
2. ARAF signs the person in if needed (email OTP), checks the redirect against its allowlist, and returns
   a single-use 60-second `code`.
3. `GET /api/auth/admin/sso/callback` checks the state, then exchanges the code server-to-server
   (signed). It admits the person only if all of these hold:
   * the email is in `STAFF_EMAIL_DOMAINS`;
   * the ARAF sign-in is less than 12 hours old;
   * a matching **active staff user already exists here**.
4. The session is issued as MFA-verified (ARAF's email OTP was the second factor). It is audited as
   `auth.login` with method `ARAF_SSO`.
5. A refusal returns to `/login?sso_error=…`:

| Code | Meaning |
|---|---|
| `STATE` | The state check failed. |
| `EXCHANGE` | ARAF refused the code. |
| `UNAVAILABLE` | ARAF could not be reached. |
| `DOMAIN` | The email is outside the staff domains. |
| `NOT_PROVISIONED` | No staff user here has that email. |
| `DENIED` | The account is inactive or the ARAF sign-in is too old. |

Roles stay here. ARAF never grants permissions in Pay with ARAF. New staff are still invited by a Super
Admin under maker-checker.

## Bringing it up locally

1. Start ARAF on `http://localhost:3000` with these settings:
   * `PAY_WITH_ARAF_ENABLED=true`
   * `PAY_WITH_ARAF_SECRET=<s>`
   * `PAY_WITH_ARAF_CALLBACK_URL=http://localhost:4000/api/callbacks/araf`
   * `PAY_WITH_ARAF_SSO_REDIRECT_URIS=http://localhost:3003/api/auth/admin/sso/callback` (the admin
     portal's URL)
   * Run ARAF's worker too.
2. Start Pay with ARAF with these settings:
   * `ARAF_MODE=connected`
   * `ARAF_BASE_URL=http://localhost:3000`
   * `ARAF_INTEGRATION_SECRET=<s>`
   * `ARAF_SSO_ENABLED=true`
3. Give the ARAF staff member a matching staff user in Pay with ARAF (same email).

Tests: `apps/api/test/araf-connected.test.ts` here (against a stand-in that checks the signatures),
`tests/pay-with-araf.test.ts` in ARAF.
