# Changelog

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
