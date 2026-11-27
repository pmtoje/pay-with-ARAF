# Production readiness

**Sandbox demonstration: ready** (see `TEST_PLAN.md` for evidence).
**Production: NOT ready.** The system is engineered to fail closed until every gate below is met.

## Production gates (spec §68)

**Business approvals.** On 2026-11-27 the product owner stated in the build conversation that these are
approved. This document does not hold the approvals themselves. For each row, attach the approver's name,
the date and the signed document or email before go-live. Until then the status is *Reported approved —
evidence to attach*.

| Gate | Owner | Status | Evidence |
| --- | --- | --- | --- |
| Approved Bank architecture | Technology / Enterprise Architecture | Reported approved — evidence to attach | |
| Approved credit policy (values in BUSINESS_RULES.md, still marked PROPOSED in code until evidence is attached) | Credit Risk | Reported approved — evidence to attach | |
| Approved financing product structure | Product / Credit / Legal | Reported approved — evidence to attach | |
| Approved Shariah contractual sequence (D-011) | Shariah governance | Reported approved — evidence to attach | |
| Approved partner agreements & settlement arrangements (incl. 2% fee, VAT, payment terms — D-033) | Legal / Finance | Reported approved — evidence to attach | |
| Approved privacy notices & consent texts (versions 2026-11.1) | Compliance / DPO | Reported approved — evidence to attach | |
| Merchant collection of BVN / date of birth (D-032) | Compliance | Reported approved — evidence to attach | |
| Pay with ARAF authorised as booking/payment originator (service accounts, limits, SoD, CAD/Finance procedures — D-013) | CAD / Finance / InfoSec | Reported approved — evidence to attach | |
| Stakeholder sign-offs | Executive sponsors | Reported approved — evidence to attach | |

**Technical gates.** These need work done, not only an approval. See `documentation/PROVIDER_REQUESTS.md`
for what to request from each provider.

| Gate | Owner | Status |
| --- | --- | --- |
| BVN identity verification + SMS gateway (API spec, credentials) | Technology / Compliance | Outstanding — pilot blocker |
| SeedFi integration | Credit Risk / Technology | Outstanding — pilot blocker. ARAF already integrates SeedFi Seed Score (API v2.0); a Pay with ARAF API key and confirmation of the same contract are needed |
| Periculum integration | Technology / Credit Risk | Outstanding — pilot blocker. ARAF already integrates Periculum Insights; Pay with ARAF credentials needed |
| AltBank core banking (accounts, statements, exposure, booking, debit) | Technology / CAD | Outstanding — pilot blocker |
| Vendor payment rail | Finance / Technology | Outstanding — pilot blocker |
| ARAF integration (API + event contract) | Technology / Credit Admin | **Built** — contract v1 implemented both sides (D-034), tested locally end to end. Needs: merge/deploy of ARAF branch `claude/pay-with-araf-connection`, production URL, shared secret |
| Outbound execution-status reporting to ARAF (D-013) | Technology / Credit Admin | **Built** — part of contract v1 |
| Remita integration | Technology / Operations | Outstanding — after pilot (pilot debits the AltBank account) |
| Mono integration | Technology | Outstanding — after pilot |
| Account opening integration (callback support) | Digital Banking | Outstanding — after pilot |
| Secrets manager / KMS; malware scanning | Technology / InfoSec | Outstanding |
| Security assessment & independent penetration test | Information Security | Outstanding |
| UAT sign-off (UAT_PACK) | All stakeholders | Outstanding (requires the live integrations above) |
| Reconciliation testing against real rails | Finance / Operations | Outstanding |
| Disaster recovery validation | Technology | Outstanding |

## External integration dependency register

| Dependency | Needed | Current state | Blocking |
| --- | --- | --- | --- |
| SeedFi API documentation + sandbox credentials | Credit assessment adapter | Simulator | Production credit |
| Mono contract + keys (Connect product) | External statement acquisition | Simulator + stand-in page | Production statements (non-AltBank) |
| Periculum API documentation + keys | Statement analysis | Simulator | Production affordability |
| BVN verification service | Identity, OTP channel | Simulator | Production identity |
| AltBank account/statement/core banking APIs | Accounts, statements, exposure, booking | Simulator | Production |
| Account opening platform callback spec | Resume after account opening | Simulator + signed callback | New-to-bank customers |
| ARAF API + status events | Authoritative approval | Built (connected mode, D-034); simulator remains for sandbox | ARAF deployment + shared secret |
| Remita mandate API | Repayment mandates | Simulator | Production |
| Payment rail (NIP / internal) | Vendor payment + refunds | Simulator | Production payments |
| SMS / email gateway | Notifications, OTP | Email live via Resend; SMS sandbox inbox | Production OTP (SMS) |
| Malware scanning service | PDF uploads | EICAR detection only | Production uploads |
| KMS/HSM, secrets manager | Key management | Env-var keys (local) | Production |
| Enterprise IdP (SSO) | Staff authentication | Sign in with ARAF (@altbank.ng) built; local accounts + TOTP (QR enrolment) | Recommended |
| Official brand assets | Visual identity | Provisional tokens | Brand compliance |
| Sterling ASVS document | Security verification mapping | Not supplied | Security sign-off |
| SeedFi SWR / ARAF process documents | Requirements authority | Not supplied (spec text used) | Traceability to source |

## Known limitations
* Source documents listed in spec §3 (SWR, ARAF process, brand, provider docs) were not supplied;
  the build follows the specification text and records every interpretation as PROPOSED.
* Portfolio reporting (outstanding balances, repayments, past-due) is intentionally unavailable —
  requires core banking integration.
* Customer equity is enabled in the sandbox (D-023): the merchant collects it and confirms it via
  the API; the Bank does not collect equity itself. Refund of confirmed equity on later cancellation
  is a merchant obligation still to be agreed.
* Embedded checkout requires HTTPS in production (partitioned cookies); live provider pages that
  refuse framing (Remita, Mono) need pop-up adapters (D-026).
* Returns after completion record refunds and reverse the (simulated) booking but do not compute
  residual financing balances (core banking responsibility).
* WhatsApp notifications not implemented (channel not approved/integrated).
* Excel export: CSV only (formula-injection safe).
* OpenTelemetry tracing SDK not wired (correlation ids, structured logs and metrics are).

## Business decisions requiring approval
D-004 brand · D-005 score bands · D-007 obligations source · D-008 exposure definition ·
D-010 / D-023 customer equity · D-024 per-annum product rates · D-025 business-owner 10% of turnover · D-011 contractual sequence · offer and
assessment validity windows · minimum financing amount (₦20,000) · age limits (18–65) ·
business-owner affordability model · thin-file policy · notification templates and consent texts.
