# User acceptance testing pack

> Sign-offs below are **blank**. No stakeholder has signed off. Do not mark a test as passed
> without executing it and attaching evidence.

## How to run
Environment: sandbox (see `DEPLOYMENT.md`). Test identities: Developer portal → Sandbox testing.
Staff accounts: `README.md`. Record actual result, evidence (screenshot / correlation id) and defects.

## Test case template

| Field | Value |
| --- | --- |
| Test ID | |
| Requirement reference | (REQUIREMENTS_TRACEABILITY.md ref) |
| Scenario | |
| Preconditions | |
| Test data | |
| Steps | |
| Expected result | |
| Actual result | |
| Pass / Fail | |
| Evidence | |
| Responsible stakeholder | |
| Defect reference | |

## Business
| Test ID | Ref | Scenario | Test data | Expected result |
| --- | --- | --- | --- | --- |
| UAT-BUS-01 | §71.1–4 | Onboard a marketplace partner end-to-end | New partner details | Maker submits; checker approves; SANDBOX_ACTIVE; admin invited; key + webhook created |
| UAT-BUS-02 | §71.5–30 | Full happy path from AltMall | BVN 22200000001 / 1990-04-12 | Order delivered; dashboards updated |
| UAT-BUS-03 | §29 | Eligibility below cart → cart revision | BVN 22200000013 / 1996-05-05, ₦450k cart | Customer told eligible amount; revised cart proceeds without re-checks |
| UAT-BUS-04 | §41 | Partner dashboard metrics | Date filters | Figures match application list |

## Credit Risk
| UAT-CR-01 | §16 | Score boundaries (simulator) | Policy simulator in admin | 279/801 invalid, 280/529 poor, 530/619 fair, 620/800 good |
| UAT-CR-02 | §18 | Fair credit review clear (maker-checker) | BVN 22200000003 | Analyst proposes; reviewer approves; journey continues |
| UAT-CR-03 | §18 | Fair credit decline | BVN 22200000004 | Declined after checker approval |
| UAT-CR-04 | §16 | Thin file | BVN 22200000006 | Thin-file queue; no zero score |
| UAT-CR-05 | §25 | Missing salary month | BVN 22200000011 | Declined (complete statement) |
| UAT-CR-06 | §27 | High obligations | BVN 22200000012 | Declined, no capacity |
| UAT-CR-07 | §26 | Business owner | BVN 22200000014 | 12-month statement; manual review |
| UAT-CR-08 | §27 | Concurrent exposure | BVN 22200000028, two ₦300k carts | Only one reserves within ₦400k remaining |
| UAT-CR-09 | §27–28 | Policy change maker-checker | Propose v2 | Activation needs a different approver; old offers unchanged |

## Customer Experience
| UAT-CX-01 | §13 | Mobile journey usability (375px) | Any | All steps readable, operable, clear status |
| UAT-CX-02 | §56 | Abandon and resume | Close browser mid-journey | Resume via OTP; no repeated steps |
| UAT-CX-03 | §17 | Decline messaging | BVN 22200000005 | Respectful message; back to merchant |
| UAT-CX-04 | §30 | Offer clarity | Any eligible | Indicative vs approval distinction; schedule; PDF |

## Operations
| UAT-OPS-01 | §55 | Mandate failure handling | BVN 22200000017 | Exception raised; customer can retry |
| UAT-OPS-02 | §55 | ARAF information request | Simulator REQUEST_INFO | Customer responds; case resumes |
| UAT-OPS-03 | §39 | Cancellation after payment | Partner cancels after vendor payment | Reversal workflow; refund approval; reconciliation |

## CAD
| UAT-CAD-01 | §35 | Booking success | Happy path | FIN-SBX-… reference; financing.booked |
| UAT-CAD-02 | §35 | Booking failure | BVN 22200000018 | Payment blocked; exception |
| UAT-CAD-03 | §31 | Possession evidence before sale execution | Happy path | Customer cannot sign sale before CAD evidence |

## Finance
| UAT-FIN-01 | §36 | Payment maker-checker | Happy path | Settlement cannot approve own; finance approves |
| UAT-FIN-02 | §36 | Payment failure | BVN 22200000019 | Exception; new instruction requires approval |
| UAT-FIN-03 | §36 | Unknown payment status | BVN 22200000020 | No re-initiation; reconciliation confirms |
| UAT-FIN-04 | §50 | Reconciliation run | After several journeys | Findings listed and resolvable |

## Compliance
| UAT-CMP-01 | §15 | Consent records | Any | Versioned consent rows with evidence |
| UAT-CMP-02 | §54 | Audit trail | Any admin action | Searchable, chain verified, immutable |
| UAT-CMP-03 | §37 | Release suspension | Compliance hold | goods.release_suspended; partner sees SUSPENDED |

## Information Security
| UAT-SEC-01 | §44 | MFA enforcement & lockout | Wrong passwords ×5 | Account locked; MFA required |
| UAT-SEC-02 | §9 | Tenant isolation | Two partners | Cross-tenant ids return 404 |
| UAT-SEC-03 | §46 | Webhook signature & replay | Developer verifier | Tampered/old payloads rejected |
| UAT-SEC-04 | §23 | Malicious upload | EICAR / JS PDF | Rejected |

## Technology
| UAT-TEC-01 | §67 | Fresh deployment from docs | DEPLOYMENT.md | Stack starts; health ready |
| UAT-TEC-02 | §68 | Production fail-closed | APP_ENV=production with unsafe config | Start-up refused |

## Legal / Shariah governance
| UAT-LEG-01 | §31 | Document wording review | Promise, offer letter, sale agreement | Wording approved or changes logged |
| UAT-SHA-01 | §31 | Contractual sequence | D-011 | Sequence approved or amended |

## Partner integration
| UAT-PAR-01 | §46 | Webhook integration | Partner endpoint | Signed events received and verified |
| UAT-PAR-02 | §37 | Release verification API | REL reference | Merchant ships only when authorised |

## Sign-off
| Function | Name | Decision (Approve / Approve with conditions / Reject) | Conditions | Signature | Date |
| --- | --- | --- | --- | --- | --- |
| Business | | | | | |
| Credit Risk | | | | | |
| Customer Experience | | | | | |
| Operations | | | | | |
| CAD | | | | | |
| Finance | | | | | |
| Compliance | | | | | |
| Information Security | | | | | |
| Technology | | | | | |
| Legal | | | | | |
| Shariah governance | | | | | |
| Partner integration | | | | | |
