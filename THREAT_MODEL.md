# Threat model (STRIDE)

Scope: hosted checkout, partner API, partner/admin portals, worker, webhooks, provider adapters.
Assets: customer identity & financial data, financing decisions, vendor payments, release
authorisations, credentials, audit trail.

## Trust boundaries
1. Internet → hosted checkout / portals (browser).
2. Merchant servers → partner API (secret keys).
3. API → external providers (adapters).
4. ARAF / account opening → API callbacks.
5. Worker → merchant webhook endpoints (outbound).
6. API/worker → database, storage, Redis.

| # | Threat (STRIDE) | Scenario | Mitigations | Residual / follow-up |
| --- | --- | --- | --- | --- |
| T1 | Spoofing | Attacker with a checkout URL accesses a customer's data | Nothing personal before OTP; OTP to BVN-linked phone; session bound to application | SIM-swap risk on phone OTP → Bank fraud controls |
| T2 | Spoofing | Identity takeover with known BVN + DOB | OTP to identity-linked channel; BVN+DOB insufficient; rate limits per IP and BVN hash; lock after 5 failures | Device fingerprinting / fraud scoring (future) |
| T3 | Spoofing | Forged webhooks to merchant | HMAC with per-endpoint secret, timestamp tolerance, event id dedupe, verification API | Merchant must implement verification (documented, AltMall reference) |
| T4 | Spoofing | Forged ARAF/account-opening callbacks | HMAC over raw body; server-side re-verification with provider before acting | Replace shared secret with mTLS/JWS per Bank standard |
| T5 | Tampering | Customer changes cart/amount in browser | Server-side cart snapshot + hash; amounts never accepted from customer; revision only via merchant API | — |
| T6 | Tampering | Manipulating credit score / affordability | Scores only from provider adapter; rules server-side; customer cannot submit financial figures except enhanced form (reviewed by staff) | — |
| T7 | Tampering | Skipping journey steps by calling APIs directly | Server-enforced state machine, preconditions per action, tests | — |
| T8 | Tampering | Audit log alteration | Hash chain + DB trigger blocking UPDATE/DELETE; verify endpoint | DB superuser can still bypass → ship to WORM/SIEM |
| T9 | Repudiation | Staff deny approving a payment | Maker-checker records, audit with actor/roles/IP/correlation id | — |
| T10 | Info disclosure | Partner reads another partner's applications (IDOR) | Tenant from credential; partnerId+environment in every query; 404 on foreign ids; tests | — |
| T11 | Info disclosure | Partner learns credit details | Merchant presenters exclude credit data; webhooks contain only status; tests assert absence | — |
| T12 | Info disclosure | Sensitive data in logs/URLs/notifications | Redaction, no bodies in access logs, BVN never in URLs, OTP never persisted | Log pipeline DLP |
| T13 | Info disclosure | Staff over-access to customer financial data | Sensitive permission gating, access audit, super admin has no financial access | Periodic access reviews |
| T14 | DoS | OTP flooding / brute force | Per-application send limit, resend cooldown, attempt limits, rate limiter fails closed | WAF/bot management |
| T15 | DoS | Large/malicious uploads | 10 MB transport cap, policy 5 MB, memory storage, structural checks | AV service, async scanning at scale |
| T16 | Elevation | Self-approval / role escalation | Maker≠checker in service and DB; role changes need approval; cannot change own roles | — |
| T17 | Elevation | SSRF via webhook URL to internal network/metadata | URL policy, DNS pinning, private range blocking, no redirects | Egress firewall |
| T18 | Financial | Duplicate vendor payment after timeout | Idempotency key per instruction, UNKNOWN status + reconciliation, DB partial unique index | Reconciliation with real rail statements |
| T19 | Financial | Release before payment confirmation | Release gate (authoritative confirmation + all conditions) under row lock; merchant verification API | — |
| T20 | Financial | Concurrent applications exceed single obligor limit | Obligor row lock + reservations; concurrency test | Core banking exposure must be authoritative |
| T21 | Financial | Simulator used for live records | Separate deployments, environment checks, live adapters fail closed, config refuses unsafe combos | Deployment change control |
| T22 | Supply chain | Malicious dependency | Pinned versions, lockfile, audit, container scan | SBOM + signed images |
