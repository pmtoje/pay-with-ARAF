/**
 * SANDBOX TEST IDENTITIES — synthetic, clearly fictional people.
 *
 * BVNs in the 222000000xx range are reserved for this simulator and will never resolve in
 * production. Every sandbox scenario from spec §60 is reachable with one of these
 * identities (plus simulator controls in the admin portal for ARAF / operational outcomes).
 */

export type ForcedOutcome =
  | 'MANDATE_FAILURE'
  | 'BOOKING_FAILURE'
  | 'PAYMENT_FAILURE'
  | 'PAYMENT_UNKNOWN'
  | 'ANALYSIS_FAILURE'
  | 'ARAF_REPORTING_FAILURE'
  | 'CARD_DECLINED';

export interface StatementProfile {
  kind: 'SALARY' | 'BUSINESS';
  employer?: string;
  /** Net salary in naira for each of the last 12 complete months, oldest first. null = no salary that month. */
  monthlySalaryNaira?: Array<number | null>;
  /** Month indexes (0..11, oldest first) where the salary credit is ambiguous ("POSSIBLE_SALARY"). */
  uncertainMonths?: number[];
  /** Split salary into two credits in these month indexes. */
  splitMonths?: number[];
  monthlyRevenueNaira?: number[];
  monthlyObligationsNaira: number;
  otherMonthlyInflowNaira: number;
  averageBalanceNaira: number;
}

export interface SandboxIdentity {
  scenario: string;
  title: string;
  description: string;
  bvn: string;
  dateOfBirth: string;
  firstName: string;
  lastName: string;
  phone: string;
  /** undefined → no credit history (thin file). */
  score?: number | 'INVALID' | 'TIMEOUT';
  bureauObligationsNaira: number;
  existingExposureNaira: number;
  hasAltBankAccount: boolean;
  altBankHistoryMonths: number;
  accountStatus?: 'ACTIVE' | 'DORMANT' | 'POST_NO_DEBIT';
  statement: StatementProfile;
  forced?: ForcedOutcome[];
  identityProviderDown?: boolean;
  suggestedPath: string;
}

const salary = (amounts: Array<number | null>, extra: Partial<StatementProfile> = {}): StatementProfile => ({
  kind: 'SALARY',
  employer: 'LAGOON LOGISTICS LTD',
  monthlySalaryNaira: amounts,
  monthlyObligationsNaira: 50_000,
  otherMonthlyInflowNaira: 35_000,
  averageBalanceNaira: 210_000,
  ...extra,
});

/** Example from the specification: lowest verified salary ₦480,000, obligations ₦50,000. */
const SPEC_EXAMPLE_SALARY = [500_000, 500_000, 520_000, 480_000, 500_000, 550_000, 500_000, 500_000, 520_000, 480_000, 500_000, 550_000];

export const SANDBOX_IDENTITIES: SandboxIdentity[] = [
  {
    scenario: 'GOOD_EXISTING_CUSTOMER',
    title: 'Good credit · existing AltBank customer',
    description: 'SeedScore 712. Existing account with 12 months of salary history. Recognised salary ₦480,000; eligible for ≈ ₦1.05m over 12 months.',
    bvn: '22200000001', dateOfBirth: '1990-04-12', firstName: 'Adaeze', lastName: 'Okonkwo-Test', phone: '+2348030000001',
    score: 712, bureauObligationsNaira: 50_000, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 12,
    statement: salary(SPEC_EXAMPLE_SALARY), suggestedPath: 'AltBank statement → offer → ARAF → payment → release',
  },
  {
    scenario: 'GOOD_NEW_CUSTOMER',
    title: 'Good credit · new to AltBank',
    description: 'SeedScore 684. No AltBank account → account opening (can be interrupted and resumed). New account has no history → use Mono or PDF.',
    bvn: '22200000002', dateOfBirth: '1993-09-03', firstName: 'Tunde', lastName: 'Bakare-Test', phone: '+2348030000002',
    score: 684, bureauObligationsNaira: 20_000, existingExposureNaira: 0, hasAltBankAccount: false, altBankHistoryMonths: 0,
    statement: salary([650_000, 650_000, 650_000, 650_000, 650_000, 650_000, 650_000, 650_000, 650_000, 650_000, 650_000, 650_000], { monthlyObligationsNaira: 20_000, employer: 'HARMATTAN SOFTWARE LTD' }),
    suggestedPath: 'Account opening → Mono or PDF → offer',
  },
  {
    scenario: 'FAIR_REVIEW_APPROVE',
    title: 'Fair credit · enhanced review (clear)',
    description: 'SeedScore 575 → enhanced assessment form → credit analyst clears (checker approves) → continue.',
    bvn: '22200000003', dateOfBirth: '1988-01-22', firstName: 'Chioma', lastName: 'Eze-Test', phone: '+2348030000003',
    score: 575, bureauObligationsNaira: 40_000, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 12,
    statement: salary([420_000, 420_000, 420_000, 420_000, 420_000, 420_000, 420_000, 420_000, 420_000, 420_000, 420_000, 420_000], { monthlyObligationsNaira: 40_000 }),
    suggestedPath: 'Enhanced review queue → clear',
  },
  {
    scenario: 'FAIR_REVIEW_DECLINE',
    title: 'Fair credit · enhanced review (decline)',
    description: 'SeedScore 548 with delinquency indicators → enhanced review → analyst declines.',
    bvn: '22200000004', dateOfBirth: '1985-06-30', firstName: 'Emeka', lastName: 'Nwosu-Test', phone: '+2348030000004',
    score: 548, bureauObligationsNaira: 120_000, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 12,
    statement: salary(Array(12).fill(300_000), { monthlyObligationsNaira: 120_000 }),
    suggestedPath: 'Enhanced review queue → decline',
  },
  {
    scenario: 'POOR_CREDIT',
    title: 'Poor credit',
    description: 'SeedScore 412 → respectful decline; partner notified without credit details.',
    bvn: '22200000005', dateOfBirth: '1991-11-11', firstName: 'Bola', lastName: 'Adeyemi-Test', phone: '+2348030000005',
    score: 412, bureauObligationsNaira: 90_000, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 12,
    statement: salary(Array(12).fill(250_000)), suggestedPath: 'Decline after credit check',
  },
  {
    scenario: 'NO_CREDIT_HISTORY',
    title: 'No credit history (thin file)',
    description: 'SeedFi returns no score. Never treated as zero — routed to manual thin-file review per policy.',
    bvn: '22200000006', dateOfBirth: '2000-02-14', firstName: 'Zainab', lastName: 'Bello-Test', phone: '+2348030000006',
    score: undefined, bureauObligationsNaira: 0, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 8,
    statement: salary(Array(12).fill(280_000), { monthlyObligationsNaira: 0 }), suggestedPath: 'Thin-file review queue',
  },
  {
    scenario: 'MISSING_SALARY_MONTH',
    title: 'Missing salary month',
    description: 'Good credit, but a complete and reliable statement shows no salary in one of the last six months → decline per SWR rule.',
    bvn: '22200000011', dateOfBirth: '1989-07-07', firstName: 'Ifeoma', lastName: 'Obi-Test', phone: '+2348030000011',
    score: 701, bureauObligationsNaira: 30_000, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 12,
    statement: salary([400_000, 400_000, 400_000, 400_000, 400_000, 400_000, 400_000, 400_000, null, 400_000, 400_000, 400_000]),
    suggestedPath: 'AltBank statement → decline (missing salary)',
  },
  {
    scenario: 'HIGH_OBLIGATIONS',
    title: 'High existing obligations',
    description: 'Existing obligations exceed 33.3% of income → zero repayment capacity → decline.',
    bvn: '22200000012', dateOfBirth: '1984-03-19', firstName: 'Kunle', lastName: 'Afolabi-Test', phone: '+2348030000012',
    score: 668, bureauObligationsNaira: 190_000, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 12,
    statement: salary(Array(12).fill(500_000), { monthlyObligationsNaira: 190_000 }), suggestedPath: 'Affordability → decline',
  },
  {
    scenario: 'INSUFFICIENT_ELIGIBILITY',
    title: 'Insufficient eligibility for cart',
    description: 'Recognised salary ₦150,000 → eligible ≈ ₦300k over 12 months. With a ₦450k cart: cart revision required (partial financing disabled by default).',
    bvn: '22200000013', dateOfBirth: '1996-05-05', firstName: 'Ngozi', lastName: 'Umeh-Test', phone: '+2348030000013',
    score: 655, bureauObligationsNaira: 25_000, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 12,
    statement: salary(Array(12).fill(150_000), { monthlyObligationsNaira: 25_000 }), suggestedPath: 'Offer below cart → return to merchant and revise cart',
  },
  {
    scenario: 'BUSINESS_OWNER',
    title: 'Business owner',
    description: 'Self-employed. Requires 12 months of statements and manual review (24–48h contact target).',
    bvn: '22200000014', dateOfBirth: '1980-10-01', firstName: 'Musa', lastName: 'Ibrahim-Test', phone: '+2348030000014',
    score: 690, bureauObligationsNaira: 60_000, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 14,
    statement: { kind: 'BUSINESS', monthlyRevenueNaira: [1_800_000, 2_100_000, 1_650_000, 2_400_000, 2_000_000, 1_900_000, 2_250_000, 2_600_000, 1_700_000, 2_050_000, 2_300_000, 2_900_000], monthlyObligationsNaira: 60_000, otherMonthlyInflowNaira: 0, averageBalanceNaira: 900_000 },
    suggestedPath: 'Choose "Business owner" → 12-month statement → manual review queue',
  },
  {
    scenario: 'UNCERTAIN_SALARY',
    title: 'Uncertain salary classification',
    description: 'One month’s salary credit is ambiguous → affordability review queue (not an automatic decline).',
    bvn: '22200000015', dateOfBirth: '1992-12-12', firstName: 'Segun', lastName: 'Ojo-Test', phone: '+2348030000015',
    score: 640, bureauObligationsNaira: 30_000, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 12,
    statement: salary(Array(12).fill(380_000), { uncertainMonths: [9] }), suggestedPath: 'Borderline / affordability review queue',
  },
  {
    scenario: 'SPLIT_SALARY',
    title: 'Split salary payments',
    description: 'Salary paid in two tranches each month — consolidated without double counting.',
    bvn: '22200000016', dateOfBirth: '1994-08-08', firstName: 'Amaka', lastName: 'Igwe-Test', phone: '+2348030000016',
    score: 705, bureauObligationsNaira: 15_000, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 12,
    statement: salary(Array(12).fill(600_000), { splitMonths: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], monthlyObligationsNaira: 15_000 }),
    suggestedPath: 'Normal path; inspect affordability month breakdown',
  },
  {
    scenario: 'MANDATE_FAILURE',
    title: 'Mandate failure',
    description: 'Remita mandate activation fails → operational exception; customer can retry.',
    bvn: '22200000017', dateOfBirth: '1990-01-17', firstName: 'Femi', lastName: 'Lawal-Test', phone: '+2348030000017',
    score: 720, bureauObligationsNaira: 30_000, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 12,
    statement: salary(Array(12).fill(520_000)), forced: ['MANDATE_FAILURE'], suggestedPath: 'Happy path until mandate',
  },
  {
    scenario: 'BOOKING_FAILURE',
    title: 'Booking failure',
    description: 'Core banking booking fails → vendor payment blocked; exception raised.',
    bvn: '22200000018', dateOfBirth: '1990-01-18', firstName: 'Halima', lastName: 'Sani-Test', phone: '+2348030000018',
    score: 720, bureauObligationsNaira: 30_000, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 12,
    statement: salary(Array(12).fill(520_000)), forced: ['BOOKING_FAILURE'], suggestedPath: 'Happy path until booking',
  },
  {
    scenario: 'PAYMENT_FAILURE',
    title: 'Vendor payment failure',
    description: 'Payment rail rejects the vendor payment → release stays blocked; exception raised.',
    bvn: '22200000019', dateOfBirth: '1990-01-19', firstName: 'Yemi', lastName: 'Alade-Test', phone: '+2348030000019',
    score: 720, bureauObligationsNaira: 30_000, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 12,
    statement: salary(Array(12).fill(520_000)), forced: ['PAYMENT_FAILURE'], suggestedPath: 'Happy path until vendor payment',
  },
  {
    scenario: 'PAYMENT_UNKNOWN',
    title: 'Unknown payment status',
    description: 'Payment initiation times out (outcome unknown). The system refuses to retry and reconciles: the payment had in fact succeeded — no double payment.',
    bvn: '22200000020', dateOfBirth: '1990-01-20', firstName: 'Dapo', lastName: 'Ogun-Test', phone: '+2348030000020',
    score: 720, bureauObligationsNaira: 30_000, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 12,
    statement: salary(Array(12).fill(520_000)), forced: ['PAYMENT_UNKNOWN'], suggestedPath: 'Happy path until vendor payment → reconciliation',
  },
  {
    scenario: 'EXPOSURE_NEAR_LIMIT',
    title: 'Existing exposure near single-obligor limit',
    description: 'Existing Bank exposure ₦4.6m → only ₦400k remains under the ₦5m limit. Two concurrent applications cannot both reserve it.',
    bvn: '22200000028', dateOfBirth: '1979-09-09', firstName: 'Olu', lastName: 'Martins-Test', phone: '+2348030000028',
    score: 760, bureauObligationsNaira: 40_000, existingExposureNaira: 4_600_000, hasAltBankAccount: true, altBankHistoryMonths: 12,
    statement: salary(Array(12).fill(2_500_000), { monthlyObligationsNaira: 40_000 }), suggestedPath: 'Open two checkouts concurrently',
  },
  {
    scenario: 'IDENTITY_PROVIDER_DOWN',
    title: 'Identity provider unavailable',
    description: 'BVN service unavailable → safe retry message; no decline.',
    bvn: '22200000099', dateOfBirth: '1990-01-01', firstName: 'Outage', lastName: 'Case-Test', phone: '+2348030000099',
    score: 700, bureauObligationsNaira: 0, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 12,
    statement: salary(Array(12).fill(400_000)), identityProviderDown: true, suggestedPath: 'Identity step → retry message',
  },
  {
    scenario: 'CREDIT_PROVIDER_TIMEOUT',
    title: 'SeedFi timeout',
    description: 'Credit bureau call times out → technical failure, NOT poor credit; customer may retry.',
    bvn: '22200000098', dateOfBirth: '1990-01-02', firstName: 'Timeout', lastName: 'Case-Test', phone: '+2348030000098',
    score: 'TIMEOUT', bureauObligationsNaira: 0, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 12,
    statement: salary(Array(12).fill(400_000)), suggestedPath: 'Credit step → retry',
  },
  {
    scenario: 'CREDIT_INVALID_RESPONSE',
    title: 'SeedFi invalid response',
    description: 'Provider returns score 900 (outside 280–800) → invalid response, NOT good or poor.',
    bvn: '22200000097', dateOfBirth: '1990-01-03', firstName: 'Invalid', lastName: 'Score-Test', phone: '+2348030000097',
    score: 'INVALID', bureauObligationsNaira: 0, existingExposureNaira: 0, hasAltBankAccount: true, altBankHistoryMonths: 12,
    statement: salary(Array(12).fill(400_000)), suggestedPath: 'Credit step → technical failure',
  },
];

export function findSandboxIdentity(bvn: string): SandboxIdentity | undefined {
  return SANDBOX_IDENTITIES.find((i) => i.bvn === bvn);
}

/** Deterministic synthetic NUBAN-like account number for an identity (sandbox only). */
export function sandboxAccountNumber(bvn: string, suffix = 0): string {
  return `98${bvn.slice(-7)}${suffix}`.padEnd(10, '0').slice(0, 10);
}
