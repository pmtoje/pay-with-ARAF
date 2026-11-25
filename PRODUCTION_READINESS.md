# Production readiness

**Sandbox demonstration: ready** (see `TEST_PLAN.md` for evidence).
**Production: NOT ready.** The system is engineered to fail closed until every gate below is met.

## Production gates (spec §68) — all OUTSTANDING

| Gate | Owner | Status |
| --- | --- | --- |
| Approved Bank architecture | Technology / Enterprise Architecture | Outstanding |
| Confirmed SeedFi integration (API spec, credentials, certification) | Credit Risk / Technology | Outstanding |
| Confirmed Mono integration (contracted product) | Technology | Outstanding |
| Confirmed Periculum integration | Technology / Credit Risk | Outstanding |
| Confirmed identity (BVN) verification integration | Technology / Compliance | Outstanding |
| Confirmed account opening integration (callback support) | Digital Banking | Outstanding |
| Confirmed existing ARAF integration (API + event contract) | Technology / Credit Admin | Outstanding |
| Confirmed Remita integration | Technology / Operations | Outstanding |
| Confirmed core banking integration (exposure, booking) | Technology / CAD | Outstanding |
| Confirmed vendor payment integration | Finance / Technology | Outstanding |
| Approved credit policy (all PROPOSED values in BUSINESS_RULES.md) | Credit Risk | Outstanding |
| Approved financing product structure | Product / Credit / Legal | Outstanding |
| Approved Shariah contractual sequence (DECISIONS D-011) | Shariah governance | Outstanding |
| Approved partner agreements & settlement arrangements | Legal / Finance | Outstanding |
| Approved privacy notices & consent texts (versions 2026-11.1 are drafts) | Compliance / DPO | Outstanding |
| Security assessment & independent penetration test | Information Security | Outstanding |
| UAT sign-off (all sections of UAT_PACK) | All stakeholders | Outstanding |
| Reconciliation testing against real rails | Finance / Operations | Outstanding |
| Disaster recovery validation | Technology | Outstanding |
| Stakeholder sign-offs | Executive sponsors | Outstanding |

## External integration dependency register

| Dependency | Needed | Current state | Blocking |
| --- | --- | --- | --- |
| SeedFi API documentation + sandbox credentials | Credit assessment adapter | Simulator | Production credit |
| Mono contract + keys (Connect product) | External statement acquisition | Simulator + stand-in page | Production statements (non-AltBank) |
| Periculum API documentation + keys | Statement analysis | Simulator | Production affordability |
| BVN verification service | Identity, OTP channel | Simulator | Production identity |
| AltBank account/statement/core banking APIs | Accounts, statements, exposure, booking | Simulator | Production |
| Account opening platform callback spec | Resume after account opening | Simulator + signed callback | New-to-bank customers |
| ARAF API + status events | Authoritative approval | Workflow simulator | Production approvals |
| Remita mandate API | Repayment mandates | Simulator | Production |
| Payment rail (NIP / internal) | Vendor payment + refunds | Simulator | Production payments |
| SMS / email gateway | Notifications, OTP | Sandbox inbox | Production OTP |
| Malware scanning service | PDF uploads | EICAR detection only | Production uploads |
| KMS/HSM, secrets manager | Key management | Env-var keys (local) | Production |
| Enterprise IdP (SSO) | Staff authentication | Local accounts + TOTP | Recommended |
| Official brand assets | Visual identity | Provisional tokens | Brand compliance |
| Sterling ASVS document | Security verification mapping | Not supplied | Security sign-off |
| SeedFi SWR / ARAF process documents | Requirements authority | Not supplied (spec text used) | Traceability to source |

## Known limitations
* Source documents listed in spec §3 (SWR, ARAF process, brand, provider docs) were not supplied;
  the build follows the specification text and records every interpretation as PROPOSED.
* Portfolio reporting (outstanding balances, repayments, past-due) is intentionally unavailable —
  requires core banking integration.
* Partial financing (customer contribution) is implemented in the rules and release gate but
  disabled; contribution collection rails are not built.
* Returns after completion record refunds and reverse the (simulated) booking but do not compute
  residual financing balances (core banking responsibility).
* WhatsApp notifications not implemented (channel not approved/integrated).
* Excel export: CSV only (formula-injection safe).
* OpenTelemetry tracing SDK not wired (correlation ids, structured logs and metrics are).

## Business decisions requiring approval
D-004 brand · D-005 score bands · D-007 obligations source · D-008 exposure definition ·
D-010 partial financing · D-011 contractual sequence · D-013 booking/payment ownership · offer and
assessment validity windows · minimum financing amount (₦20,000) · age limits (18–65) ·
business-owner affordability model · thin-file policy · notification templates and consent texts.
