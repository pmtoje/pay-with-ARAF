# Security

> Automated tests demonstrate that specific controls work; they do **not** prove the absence of
> vulnerabilities. Independent penetration testing and Bank Information Security sign-off are
> mandatory before production. No regulatory compliance or certification is claimed.

## Reporting
Report vulnerabilities privately to the Bank's Information Security team. Do not open public issues.

## Controls implemented

| Area | Control | Where |
| --- | --- | --- |
| AuthN (staff/partner) | Password (scrypt, policy), mandatory TOTP MFA with replay protection, session rotation after MFA, 15-min idle / 8-h absolute timeout, lockout after 5 failures, rate limits, constant-work login (enumeration resistance) | `apps/api/src/auth` |
| AuthN (customer) | OTP to BVN-linked phone (5-min, single-use, HMAC-hashed, bound to challenge + browser session, 5 attempts, resend cooldown, invalidation), one active browser session, 5-min inactivity re-auth | `customer/journey.service.ts` |
| AuthN (partner API) | `sk_test_`/`sk_live_` keys, HMAC-peppered hashes, scopes, IP allowlists, expiry, rotation, revocation, environment lock, partner-status check | `auth/auth.guard.ts`, `partners.service.ts` |
| AuthZ | Deny-by-default global guard; permission-based RBAC; segregation of duties; maker-checker (service + DB CHECK); temporary elevated roles; role changes via approval | `auth.guard.ts`, `approvals`, migration |
| Tenant isolation | Partner identity from credential/session only; every query filters partnerId + environment; cross-tenant tests | services, `scenarios.test.ts` |
| CSRF | SameSite=Strict HttpOnly session cookies + double-submit token header on all mutations | guard |
| Input validation | Zod schemas (strict) on every body; server-side cart arithmetic; integer kobo | controllers/services |
| Output | JSON only; React escaping; error envelope never leaks stack/SQL; `Cache-Control: no-store` | `errors.ts`, bootstrap |
| Headers | Helmet (CSP `default-src 'none'` on API, frame-ancestors none, HSTS when secure), Next apps CSP/XFO/nosniff/Referrer/Permissions policies | bootstrap, `next.config.mjs` |
| SSRF | Webhook URLs: HTTPS, no credentials, allowed ports, private/link-local/metadata ranges blocked (v4/v6/mapped), DNS resolved and **pinned**, no redirects | `security/ssrf.ts`, `webhooks.service.ts` |
| Webhooks | HMAC-SHA256 over `t.rawBody`, timestamp tolerance, event ids, rotation overlap, replay-safe receivers documented | `security/webhooks.ts` |
| Inbound callbacks | ARAF and account-opening callbacks HMAC-verified over raw body | `sandbox.controller.ts` (CallbacksController) |
| File upload | Size limit, magic bytes, structural checks, active content rejection, encryption rejection, malware scan (EICAR in sandbox; real AV required), SHA-256 duplicate detection, encrypted storage, server-generated keys (no path traversal), served with `CSP: sandbox` | `statements.service.ts`, `integrations/storage.ts` |
| Crypto at rest | AES-256-GCM field encryption with key ids and AAD; blind index for BVN; encrypted documents | `security/crypto.ts` |
| Financial integrity | Idempotency keys, optimistic concurrency, row locks, one live payment per application (DB), unknown-status reconciliation, release gate re-evaluated under lock | operations, migration |
| Audit | Hash-chained, append-only (DB trigger), access to sensitive data audited, verify endpoint | `core.services.ts` |
| Privacy | Masking, log redaction, no BVN/OTP in URLs/logs/notifications, OTP never persisted (sent synchronously) | `security/privacy.ts` |
| Exports | CSV formula-injection neutralisation, export permission + audit | `reports.service.ts` |
| Config | Production fails closed on unsafe settings; live adapters fail closed | `config.ts`, `integrations/live` |
| Supply chain | Pinned dependencies, lockfile, secret scan, `pnpm audit` and container scan in CI | `.github/workflows/ci.yml`, `scripts/scan-secrets.mjs` |

## Security testing performed
See `documentation/SECURITY_ASSESSMENT.md` (scope, tests, findings by severity, fixes, retests).

## Known gaps (must be addressed before production)
* Real malware scanning (ClamAV / Bank AV service); KMS/HSM key management; secrets manager.
* Enterprise SSO for staff and phishing-resistant MFA (WebAuthn) for privileged roles.
* Content Security Policy nonces for Next.js inline scripts (currently `'unsafe-inline'` limited to self).
* WAF / API gateway rules, DDoS protection, bot protection on the hosted checkout.
* Independent penetration test, threat-model review, Sterling ASVS mapping (standard not supplied).
* SIEM integration for audit and security events; data retention jobs.
