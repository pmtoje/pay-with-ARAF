# Business rules

All rules live in `packages/business-rules` as pure, deterministic functions with exhaustive unit
tests. Policy values are **versioned configuration** (`credit_policy_versions`), changed only by
maker-checker approval; every assessment, offer and release records the policy version used.

> **Status:** every value below is a **PROPOSED** interpretation (mostly from the SeedFi SWR). The
> active sandbox policy is flagged `isProposed = true`. None is an approved Bank policy.

## Money
* Integer kobo (`bigint`) everywhere. No floating point. Ratios are exact rationals.
* API wire format: JSON integers (kobo), guarded against unsafe magnitudes.

## Credit score classification (`classifyScore`)
| Score | Band | Action |
| --- | --- | --- |
| 280–529 | Poor | Decline |
| 530–619 | Fair | Enhanced assessment + manual review |
| 620–800 | Good | Proceed (not approval) |
| null / no history | Thin file | `thinFileTreatment` (default manual review) — never 0 |
| < 280, > 800, non-integer, non-number | — | **Invalid provider response** (technical failure; retry) |

Boundary tests: 279 invalid · 280 poor · 529 poor · 530 fair · 619 fair · 620 good · 800 good · 801 invalid.
Customers see plain-language outcomes, never scores.

## Identity
BVN must be 11 digits; DOB must match the identity record; age 18–65 (proposed); OTP to the
BVN-linked phone; possession of BVN + DOB is not sufficient.

## Statements
* Salary earners: 6 most recent **complete** calendar months. Business owners: 12 months +
  mandatory manual review (24–48 h contact target — a target, not a guarantee).
* Coverage must span the full required months; otherwise the customer is offered another
  channel (not declined). Ownership: statement holder name must match the verified customer
  (HIGH/MEDIUM/MISMATCH); mismatch rejects the statement.
* PDF: ≤ 5 MB (policy), `%PDF-` magic, catalogue + EOF present, no JavaScript / launch actions /
  embedded files / open actions / rich media, not encrypted, malware scan clean, not a duplicate
  (SHA-256). Tampering indicators (incremental updates, non-bank producers) are recorded.

## Salary consolidation (`assessSalary`)
* Only provider-classified `SALARY` credits count; self-transfers (counterparty = holder) and
  other deposits never count. Split payments in a month are summed; duplicates (same id, or same
  date+amount+narration) counted once.
* Month status: VERIFIED / MISSING (none or zero) / UNCERTAIN (only `POSSIBLE_SALARY`) / NOT_COVERED.
* **Recognised salary = lowest verified consolidated monthly salary** (spec example → ₦480,000).
* A confirmed missing month in a complete, reliable statement → **decline**. Unreliable
  statements, incomplete coverage or uncertain classification → **review**, never auto-decline.

## Affordability (`computeEligibility`)
```
Existing obligations   = policy.obligationsSource (default MAX(bureau, statement))
Capacity               = MAX(0, floor(income × 0.333) − existing obligations)
Max affordable (tenor) = largest F with ceil(DSP(F) / tenor) ≤ capacity   (exact search)
Remaining exposure     = MAX(0, ₦5,000,000 − existing Bank exposure − other active reservations)
Eligible (tenor)       = MIN(max affordable, exposure cap, partner max)
Max eligible           = best eligible amount across permitted tenors
```
Spec example: salary ₦480,000, obligations ₦50,000 → capacity ₦109,840 → 12-month max
₦1,054,464 (verified end-to-end through the simulator, Periculum stand-in and API).
Ratio boundaries: 33.299% within · 33.300% within · 33.301% above. Zero/negative income → no capacity.

## Pricing (Murabaha, `priceDeferredSale`)
| Tenor | Total markup |
| --- | --- |
| 1–12 months | 25% (factor 1.25) |
| 13–24 months | 50% (factor 1.50) |
| > 24 months | Unsupported |

Total markup, **not** a monthly or interest rate. Profit = round-half-up(F × bps / 10 000);
DSP = F + profit; regular instalment = ceil(DSP / tenor); final instalment adjusted so the
schedule sums exactly to DSP. Approved tenors (sandbox): 3, 6, 9, 12, 18, 24 (intersected with
partner-permitted tenors). Offers bind to their policy version; later pricing changes never alter
an accepted offer.

## Cart comparison (`compareEligibilityToCart`)
* A: eligible ≥ cart → finance the cart. B: equal → full financing.
* C: eligible < cart → partial financing (contribution = shortfall) **only if enabled**
  (disabled by default) → otherwise cart revision via a new, server-validated checkout
  session (`revises_session_id`); valid assessments are reused, affordability recomputed.
* D: eligible = 0 (or below minimum financing ₦20,000, sandbox assumption) → decline.
* Unused eligibility is never cash, never a reusable balance.

## Cart validation (server-side, never trust the client)
Line arithmetic must equal the declared amount; quantity 1–1000; unit > 0; categories eligible for
the partner and the vendor; partner min/max; one vendor per order unless enabled; vendor approved
with an active verified settlement account; return/cancel URL origins approved.

## Vendor payment preconditions
Financing approved, booking confirmed (current sequence), beneficiary verified (name enquiry) and
approved (maker-checker), vendor invoice verified by CAD, order valid, pre-payment conditions
(promise to purchase signed, mandate active), contribution verified if any, no live instruction
already, no holds. Maker (settlement) ≠ checker (finance). One live instruction per application
(DB partial unique index). Timeout ⇒ UNKNOWN ⇒ reconcile; never re-initiate blindly.

## Goods release gate (`evaluateReleaseGate`)
Authorised only when: financing approved (ARAF APPROVED event applied); payment CONFIRMED by the
authoritative source; amount = financed amount; beneficiary = approved settlement account; all
contractual conditions satisfied (promise signed, mandate active, asset acquired, possession
evidenced, cost & profit disclosed, sale contract executed); contribution verified if required;
no holds (cancellation, compliance); order valid. Re-evaluated inside a locked transaction.

| Situation | Result |
| --- | --- |
| Eligibility only | Blocked |
| Financing approved | Blocked |
| Financing booked | Blocked |
| Payment initiated / processing / failed / unknown / reversed | Blocked |
| Payment confirmed, contractual condition missing | Blocked |
| Payment confirmed, all conditions satisfied | **Authorised** |

Payment reversal or compliance hold → release SUSPENDED + `goods.release_suspended` webhook.

## State machines
`packages/business-rules/src/state-machines.ts` — application (39 states) plus separate machines
for payment, release, offer, mandate, booking, ARAF submission, statement connection, analysis job,
account opening, fulfilment, refund and partner lifecycle. Customer- and merchant-facing statuses
are derived (`statuses.ts`) and never stored.

## Validity windows (proposed)
Offer validity 24 h; credit assessment validity 30 days; application inactivity expiry per partner
configuration (default 24 h, not applied while the Bank is reviewing); customer session idle 5 min.
