# Product requirements — Pay with ARAF

## Vision
Embedded, Shariah-compliant (non-interest) asset financing at the point of sale on approved
merchant websites. *The partner sells. Pay with ARAF originates. ARAF processes and approves. The
Bank pays. The vendor delivers. The customer repays.* AltMall is the first partner; the platform is
partner-agnostic and AltPay-ready.

## Users
| User | Goals |
| --- | --- |
| Customer | Finance an eligible purchase quickly and safely on mobile; understand status at all times |
| Merchant staff | See application/payment/release status; release goods only when safe; manage integration and team |
| Merchant developers | Integrate like a payment gateway; reliable webhooks; sandbox |
| Bank staff (onboarding, credit, CAD, settlement, finance, ops, compliance, audit, management) | Control onboarding, credit, financial execution and oversight with maker-checker and audit |

## Product surfaces
1. Hosted checkout (mobile-first, progressive, save-and-resume, bank-grade security).
2. Partner portal (overview, applications, release queue, settlements, integration, team).
3. Bank administration portal (overview, approvals inbox, partners, applications, credit reviews,
   ARAF simulator (sandbox), policy, operations, reconciliation, reports, audit, users, integrations).
4. Developer portal (docs, explorer, webhook verifier, sandbox identities).
5. AltMall demonstration store (external-merchant reference implementation).

## Key requirements
* Financing journey: consent → BVN/DOB → OTP (identity-linked) → SeedFi → (enhanced review) →
  AltBank account (or account opening) → income profile → statement (AltBank / Mono / PDF) →
  Periculum → Bank affordability → offer (tenor comparison) → acceptance → ARAF → documents →
  mandate → booking → vendor payment → acquisition evidence → sale agreement → release →
  dispatch → delivery.
* Clear separation of eligibility, submission, approval, agreement, payment and release.
* Non-interest terminology and Murabaha sequencing (Shariah approval pending).
* Merchants never see credit data; customers never see scores.
* Sandbox: 30 scenarios, persistent sandbox indicator, simulated confirmations labelled simulated.
* Production: locked until gates pass; no simulated success for live records.

## Non-functional
Security (see SECURITY.md), privacy by design, WCAG 2.2 AA, light/dark mode, 99.9% availability
target (proposed), observability, audit, maker-checker, tenant isolation, exact money arithmetic.

## Success metrics (to be baselined in pilot)
Checkout-to-submission conversion, approval rate, turnaround time, webhook delivery success,
abandonment by stage, exception rate by category, reconciliation discrepancies (target 0).
