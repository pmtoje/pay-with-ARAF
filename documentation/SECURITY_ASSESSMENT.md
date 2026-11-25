# Security assessment report (internal, automated + code review)

**Scope:** local/sandbox deployment — API, worker, hosted checkout, portals, webhooks, adapters.
**Method:** automated negative tests through the HTTP API (`apps/api/test/scenarios.test.ts`,
`e2e-journey.test.ts`), unit tests of security primitives, code review against OWASP ASVS / API
Top 10 themes, dependency audit (`pnpm audit --prod`), secret scan. **Not performed:** independent
penetration test, authenticated DAST, infrastructure review, Sterling ASVS mapping (document not
supplied). This report does not certify the absence of vulnerabilities.

## Results by area

| Area | Tests / review | Result |
| --- | --- | --- |
| Broken access control / IDOR / cross-tenant | Partner B → A applications, orders, sessions, releases, cancellations, webhook retries; partner session on admin API | Pass (404 / 401) |
| Privilege escalation & SoD | Analyst → payments/users (403); maker self-approval (403 / MAKER_CHECKER_VIOLATION); ARAF recommender cannot approve | Pass |
| Authentication | Unauthenticated, invalid and revoked keys, scope enforcement, environment lock | Pass |
| MFA | TOTP verification + time-step replay rejection; session rotation after MFA | Pass (review + harness) |
| OTP | Brute force (5 attempts), replay of consumed code, cooldown, session binding, inactivity re-auth | Pass |
| CSRF | Mutation without token rejected | Pass |
| Injection | SQL-like search input treated as data (Prisma parameterised); malformed JSON → 422 without internals | Pass |
| Error leakage | No stack traces / SQL / module paths in responses | Pass |
| File upload | Non-PDF, JavaScript/OpenAction, encrypted, EICAR, duplicates | Pass |
| Webhooks | Forgery, body tampering, timestamp replay, rotation (unit) | Pass |
| Inbound callbacks | Unsigned ARAF callback rejected; stale/duplicate events ignored | Pass |
| SSRF | Private v4/v6/mapped ranges, metadata IP, credentials in URL, ports, DNS rebinding (unit) | Pass |
| Financial controls | Duplicate payment (service + DB index), unknown status reconciled not retried, release before confirmation blocked, amount/beneficiary mismatch, concurrent exposure | Pass |
| State machine bypass | Later-stage customer and staff APIs called early → INVALID_STATE | Pass |
| Data exposure to partners | Application/webhook payloads checked for credit terms | Pass |
| Audit integrity | Hash chain verification; UPDATE blocked by trigger | Pass |

## Findings

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| F-01 | High | Validation errors from shared-package zod instance returned HTTP 500 (could mask input-validation behaviour, noisy errors) | Fixed (duck-typed ZodError → 422), retested |
| F-02 | High | Vulnerable dependency versions initially pinned (Next.js incl. critical advisories, NestJS core, multer, path-to-regexp, postcss, sharp, zod 3, Prisma transitive deps) | See "Dependency remediation" |
| F-03 | Medium | Encrypted analysis copied between applications failed AAD check (availability bug; confirmed AAD binding works as a control) | Fixed (re-encrypt), retested |
| F-04 | Medium | Customers could not reopen an accepted application after the 24-h origination window | Fixed, regression test |
| F-05 | Medium | Next.js CSP allows `'unsafe-inline'` scripts (self-origin only) | Open — move to nonce-based CSP |
| F-06 | Medium | Sandbox malware scanning is signature-only (EICAR) | Open — Bank AV service required (production gate) |
| F-07 | Low | `/metrics` is unauthenticated (technical counters only) | Open — restrict at ingress |
| F-08 | Low | Phone OTP is susceptible to SIM swap | Accepted for sandbox — Bank fraud controls / step-up |
| F-09 | Info | Hosted checkout keeps the CSRF token in `sessionStorage` (per tab) so same-tab provider redirects do not force re-verification; session cookie remains HttpOnly | Accepted (documented) |

## Dependency remediation
See the final section appended after the upgrade run (versions and residual advisories).

## Mandatory before production
Independent penetration test; DAST in pipeline; WAF/API gateway policies; KMS/HSM and secrets
manager; enterprise SSO + WebAuthn for privileged staff; SIEM integration; AV service; container
image signing + SBOM; InfoSec sign-off.
