# API documentation

| Surface | Base path | Auth | Spec |
| --- | --- | --- | --- |
| Public partner API v1 | `/api/v1` | `Authorization: Bearer sk_test_…` (scoped) | `documentation/openapi.yaml`, Developer portal |
| Hosted checkout | `/api/checkout/sessions/:sessionId` | Customer session cookie + CSRF header; OTP for personal data | `apps/api/src/customer/customer.controller.ts` |
| Partner portal | `/api/partner-portal` | Partner session (TOTP) + CSRF | `apps/api/src/partners/partner-portal.controller.ts` |
| Admin portal | `/api/admin` | Staff session (TOTP) + CSRF + permissions | `apps/api/src/admin/admin.controller.ts` |
| Auth | `/api/auth` | — | `apps/api/src/auth/auth.controller.ts` |
| Callbacks | `/api/callbacks/{araf,account-opening}` | HMAC-SHA256 over raw body (`X-ARAF-Signature`) | `sandbox.controller.ts` |
| Sandbox simulators | `/api/sandbox` | Sandbox deployments only (404 otherwise) | `sandbox.controller.ts` |
| Health / metrics | `/health/live`, `/health/ready`, `/metrics` | Public (restrict at ingress) | `health.controller.ts` |

## Conventions
* JSON, snake_case on the public API; integer kobo for money; ISO-8601 UTC timestamps.
* Errors: `{ "error": { "code", "message", "retryable", "details"?, "correlation_id" } }`.
  Full catalogue: `packages/types/src/errors.ts` (also in the Developer portal).
* Every response carries `X-Correlation-Id`; send your own (8–64 chars) to correlate.
* `Idempotency-Key` is **required** on `POST /api/v1/checkout/sessions`; replays return the
  original response with `Idempotent-Replayed: true`; reuse with a different body → 422.
* Rate limits: 600 requests/min per API key; tighter limits on authentication and OTP.
* Pagination: `limit` (≤ 200) on list endpoints; portal lists use `page` / `page_size`.

## Webhooks
Envelope:
```json
{
  "event_id": "evt_…", "event": "goods.release_authorized", "version": "1.0",
  "created_at": "2026-11-25T09:00:00.000Z", "livemode": false, "partner_id": "…",
  "resource_version": 27,
  "data": {
    "application_reference": "ARAF-2026-000001", "merchant_order_reference": "ALTMALL-ORD-000001",
    "status": "READY_FOR_RELEASE", "currency": "NGN", "vendor_payment_amount": 45000000,
    "payment_reference": "PAY-000001", "payment_status": "CONFIRMED",
    "release_authorized": true, "release_reference": "REL-000001"
  }
}
```
Headers: `ARAF-Signature: t=<unix>,v1=<hex>` (one `v1` per active secret during rotation),
`ARAF-Event-Id`, `ARAF-Timestamp`. Signature = `HMAC-SHA256(secret, "<t>.<raw body>")`.
Tolerance 300 s. At-least-once delivery; exponential backoff with jitter; 8 attempts then
dead-letter; manual retry via API/portal; endpoints suspended after 25 consecutive failures.
Process idempotently by `event_id`; ignore events with a lower `resource_version` than you
have stored. Event catalogue: `packages/types/src/events.ts`.

## Example
```bash
curl -X POST http://localhost:4000/api/v1/checkout/sessions \
  -H "Authorization: Bearer $ARAF_SECRET_KEY" \
  -H "Idempotency-Key: order-ALTMALL-ORD-000001" \
  -H "Content-Type: application/json" \
  -d '{"merchant_order_reference":"ALTMALL-ORD-000001","currency":"NGN","amount":45000000,
       "items":[{"sku":"PHONE-001","name":"Smartphone","quantity":1,"unit_amount":45000000,
                 "category":"smartphones","vendor_reference":"VENDOR-LEKKI-ELEC"}],
       "customer":{"email":"customer@example.com","phone":"+2348000000000"},
       "return_url":"http://localhost:3005/orders/ALTMALL-ORD-000001",
       "cancel_url":"http://localhost:3005/cart"}'
```
