# Failure handling: failed payments, slow networks and refreshes

How Pay with ARAF behaves when something fails or the connection is unreliable. The rule throughout:
**the Bank's server state is the truth; screens, redirects and panel events are never proof.**

## 1. Customer on a slow or dropped connection (hosted / embedded checkout)

| Situation | Behaviour | Where |
| --- | --- | --- |
| A step is submitted and the response never arrives (timeout, dropped Wi-Fi) | Every state-changing request carries an `Idempotency-Key`. The browser retries up to 4 times with backoff (1 s, 2 s, 4 s) using the **same** key. If the first attempt already succeeded, the server replays the stored result (`Idempotent-Replayed: true`) instead of acting again. | `packages/ui/src/api.ts` (`retryWrites`), `apps/api/src/customer/customer-idempotency.interceptor.ts` |
| The retry arrives while the first attempt is still running | `409 IDEMPOTENCY_IN_PROGRESS` → the browser waits and retries. | same |
| Retries are exhausted | The checkout re-reads the authoritative state from the Bank and tells the customer: “We’ve loaded your latest progress… if this step still shows, try again — it won’t be applied twice.” | `components/checkout/context.tsx` (`NETWORK_UNCERTAIN`) |
| Same key re-used for a different request | `422 IDEMPOTENCY_KEY_REUSED`. | interceptor |
| Redis (idempotency store) unavailable | Requests run normally; the application state machine still rejects duplicate transitions (`INVALID_STATE`) and financial actions take row locks. Idempotency is defence in depth, never the only guard. | `StateService`, `AppContextService.lockApplication` |
| Customer goes offline | An offline notice explains progress is saved; the state is re-read when the connection returns. Polling pauses while the tab is hidden. | `CheckoutApp.tsx` |
| Page refresh, closed tab or closed panel | Nothing is lost: progress is stored server-side. Re-opening the same checkout URL resumes at the current step (same tab: no code; new browser or after 5 minutes idle: one-time code). | `JourneyService.view`, resume OTP |
| Double-click | Buttons are disabled while busy and actions are single-flight in the UI; the server is idempotent as above. | `useAction` |
| OTP sent twice | Resend is rate-limited with a cooldown; only the latest code is valid. | `JourneyService.issueOtp` |

## 2. Merchant integration

| Situation | Behaviour |
| --- | --- |
| Merchant page refreshes / retries session creation | `Idempotency-Key` (use the order reference) returns the original session; never a second application. Different body with the same key → 422. |
| Panel closed early or shopper navigates away | The merchant re-reads `GET /api/v1/orders/{ref}`; the shopper can re-open the panel with the same `checkout_url`. |
| Webhook delivery fails | At-least-once delivery with exponential backoff and jitter, 8 attempts, then dead-letter; manual retry in the partner portal; endpoint suspended after 25 consecutive failures. Merchants de-duplicate on `event_id` and ignore stale `resource_version`. |
| Equity payment fails at the merchant | Nothing is confirmed to the Bank, so the vendor payment stays blocked (`CONTRIBUTION_NOT_VERIFIED`). The shopper retries; `POST /orders/{ref}/equity` is idempotent on the same `payment_reference`. |
| Equity confirmed but the merchant's response was lost | Re-send the same `amount` + `payment_reference`: `{status: CONFIRMED, idempotent_replay: true}`. |

## 3. Bank-side money movement

| Situation | Behaviour |
| --- | --- |
| Vendor payment **fails** | Instruction → `FAILED`, application → `EXCEPTION` (`PAYMENT_FAILURE`), merchant gets `vendor.payment_failed`, ARAF gets `VENDOR_PAYMENT_FAILED`. Operations resolve the cause; a **new** instruction needs fresh maker-checker approval. Goods are never released. |
| Vendor payment status **unknown** (timeout) | Instruction → `UNKNOWN`. It is **never re-initiated blindly**: reconciliation queries the payment rail by idempotency key (`reconcileInstruction`) and settles it to CONFIRMED or FAILED. A partial unique index allows only one live instruction per application. |
| Confirmed payment later reversed | `vendor.payment_reversed`, release suspended (`goods.release_suspended`), exception raised. |
| Booking fails | Exception; vendor payment blocked; reported to ARAF (`BOOKING_FAILED`). |
| Mandate fails | Customer can retry with Remita; activation is always verified server-side. |
| ARAF reporting outage | Financial operations complete; reports retry in order; `ARAF_REPORTING_DELAYED` after 5 attempts. |

## 4. Tests
* API: “slow network: a retried customer action with the same Idempotency-Key is replayed, never applied twice”;
  SCN 19 (payment failure), SCN 20/27 (unknown status → reconciliation), SCN 23 (webhook retry), equity confirmation idempotency.
* Browser: the embedded journey on AltMall was run end to end in Chromium (desktop and mobile).
