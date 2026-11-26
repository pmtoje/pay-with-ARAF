/**
 * Permission-based access control catalogue.
 *
 * Authorisation is always checked against PERMISSIONS, never role names. Roles are
 * bundles of permissions; segregation of duties is enforced by (a) role design — no
 * role both makes and checks the same restricted action — and (b) runtime maker ≠ checker
 * checks on every approval (also enforced by database CHECK constraints).
 */

export const PERMISSIONS = {
  // Partner management
  'partner.read': 'View partners and their configuration',
  'partner.create': 'Create and edit partner onboarding records (maker)',
  'partner.approve': 'Approve / reject partner onboarding and configuration (checker)',
  'partner.suspend': 'Suspend or terminate partners',
  'partner.portal.configure': 'Propose partner-side (partner portal) settings for a partner (maker)',
  'partner.production.request': 'Request production activation for a partner',
  'partner.production.approve': 'Approve production activation',
  'vendor.manage': 'Create vendors and settlement accounts (maker)',
  'vendor.approve': 'Approve vendor settlement accounts (checker)',
  // Applications
  'application.read': 'View application summaries and status',
  'application.read.sensitive': 'View credit, statement and affordability details',
  'application.cancel': 'Cancel applications on behalf of the Bank',
  'document.read.sensitive': 'Open customer documents (statements, evidence)',
  // Credit
  'review.perform': 'Perform enhanced credit reviews (maker)',
  'review.approve': 'Approve enhanced review decisions (checker)',
  'policy.read': 'View credit policy versions',
  'policy.propose': 'Propose credit policy changes (maker)',
  'policy.approve': 'Approve credit policy changes (checker)',
  // ARAF sandbox simulator
  'araf.simulator.operate': 'Operate the sandbox ARAF workflow simulator (business evaluation / credit review)',
  'araf.simulator.approve': 'Final approval stage in the sandbox ARAF simulator',
  // Financing operations
  'cad.conditions.manage': 'Record asset acquisition and contractual evidence (CAD)',
  'booking.execute': 'Request financing booking in core banking (CAD)',
  'payment.initiate': 'Create vendor payment instructions (maker)',
  'payment.approve': 'Approve vendor payment instructions (checker)',
  'payment.reconcile': 'Run reconciliation and resolve payment discrepancies',
  'refund.manage': 'Manage returns, cancellations and refunds',
  'refund.approve': 'Approve financial reversals (checker)',
  'fee.manage': 'Issue ARAF merchant-fee invoices and record their payment (the issuer cannot record payment)',
  'release.suspend': 'Suspend goods release authorisations',
  'exception.manage': 'Work operational exception queues',
  // Platform
  'report.read': 'View management reports and dashboards',
  'report.export': 'Export reports',
  'audit.read': 'Search audit records',
  'user.manage': 'Invite users and propose role assignments (maker)',
  'user.approve': 'Approve role assignments (checker)',
  'integration.read': 'View integration health and logs',
  'webhook.manage.bank': 'Retry or suspend partner webhook endpoints on behalf of partners',
  // Partner portal
  'p.dashboard.read': 'View partner dashboard',
  'p.application.read': 'View partner applications',
  'p.fulfilment.manage': 'Confirm dispatch / delivery',
  'p.settlement.read': 'View settlements',
  'p.refund.request': 'Request cancellations and returns',
  'p.integration.manage': 'Manage API credentials and webhooks',
  'p.integration.read': 'View integration settings and logs',
  'p.team.manage': 'Invite and manage partner staff',
  'p.report.export': 'Export partner reports',
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

export const SENSITIVE_PERMISSIONS: PermissionCode[] = ['application.read.sensitive', 'document.read.sensitive'];

export interface RoleDefinition {
  code: string;
  name: string;
  scope: 'STAFF' | 'PARTNER';
  description: string;
  permissions: PermissionCode[];
}

export const BANK_ROLES: RoleDefinition[] = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Administrator',
    scope: 'STAFF',
    description: 'Platform administration and partner set-up (maker): creates and configures partners, their partner portal and vendors. Changes take effect only after a Partner Approving Officer approves. Deliberately has NO access to customer financial data and cannot approve partners, credit or payments.',
    permissions: ['partner.read', 'partner.create', 'partner.portal.configure', 'partner.production.request', 'vendor.manage', 'user.manage', 'integration.read', 'audit.read', 'report.read', 'policy.read'],
  },
  {
    code: 'BUSINESS_ADMIN',
    name: 'Business Administrator',
    scope: 'STAFF',
    description: 'Business ownership of the gateway and partner portfolio.',
    permissions: ['partner.read', 'partner.suspend', 'application.read', 'report.read', 'report.export', 'policy.read', 'integration.read'],
  },
  {
    code: 'PARTNER_ONBOARDING_OFFICER',
    name: 'Partner Onboarding Officer',
    scope: 'STAFF',
    description: 'Creates partner onboarding records and vendor settlement accounts (maker).',
    permissions: ['partner.read', 'partner.create', 'partner.production.request', 'vendor.manage', 'integration.read'],
  },
  {
    code: 'PARTNER_APPROVING_OFFICER',
    name: 'Partner Approving Officer',
    scope: 'STAFF',
    description: 'Approves partner onboarding, configuration, production activation and vendor accounts (checker).',
    permissions: ['partner.read', 'partner.approve', 'partner.production.approve', 'vendor.approve', 'partner.suspend'],
  },
  {
    code: 'CREDIT_ANALYST',
    name: 'Credit Analyst',
    scope: 'STAFF',
    description: 'Performs enhanced reviews and operates the ARAF sandbox evaluation stages.',
    permissions: ['application.read', 'application.read.sensitive', 'document.read.sensitive', 'review.perform', 'policy.read', 'araf.simulator.operate'],
  },
  {
    code: 'CREDIT_RISK_REVIEWER',
    name: 'Credit Risk Reviewer',
    scope: 'STAFF',
    description: 'Checker for enhanced review decisions; proposes credit policy changes.',
    permissions: ['application.read', 'application.read.sensitive', 'document.read.sensitive', 'review.approve', 'policy.read', 'policy.propose', 'report.read'],
  },
  {
    code: 'CREDIT_APPROVER',
    name: 'Credit Approver',
    scope: 'STAFF',
    description: 'Final credit approval (sandbox ARAF simulator) and policy approval (checker).',
    permissions: ['application.read', 'application.read.sensitive', 'policy.read', 'policy.approve', 'araf.simulator.approve', 'report.read'],
  },
  {
    code: 'CX_OFFICER',
    name: 'Customer Experience Officer',
    scope: 'STAFF',
    description: 'Supports customers with application status (no credit details).',
    permissions: ['application.read', 'exception.manage'],
  },
  {
    code: 'OPERATIONS_OFFICER',
    name: 'Operations Officer',
    scope: 'STAFF',
    description: 'Works operational exception queues and returns.',
    permissions: ['application.read', 'exception.manage', 'refund.manage', 'webhook.manage.bank', 'integration.read', 'application.cancel'],
  },
  {
    code: 'CAD_OFFICER',
    name: 'CAD Officer',
    scope: 'STAFF',
    description: 'Credit administration: contractual evidence, asset acquisition records and booking.',
    permissions: ['application.read', 'cad.conditions.manage', 'booking.execute', 'document.read.sensitive', 'release.suspend'],
  },
  {
    code: 'SETTLEMENT_OFFICER',
    name: 'Settlement Officer',
    scope: 'STAFF',
    description: 'Initiates vendor payment instructions (maker) and runs reconciliation.',
    permissions: ['application.read', 'payment.initiate', 'payment.reconcile', 'refund.manage', 'fee.manage'],
  },
  {
    code: 'FINANCE_OFFICER',
    name: 'Finance Officer',
    scope: 'STAFF',
    description: 'Approves vendor payments and financial reversals (checker).',
    permissions: ['application.read', 'payment.approve', 'refund.approve', 'payment.reconcile', 'report.read', 'report.export', 'fee.manage'],
  },
  {
    code: 'COMPLIANCE_OFFICER',
    name: 'Compliance Officer',
    scope: 'STAFF',
    description: 'Compliance oversight, audit search and release holds.',
    permissions: ['application.read', 'audit.read', 'report.read', 'release.suspend', 'partner.suspend'],
  },
  {
    code: 'INFOSEC_OFFICER',
    name: 'Information Security Officer',
    scope: 'STAFF',
    description: 'Security oversight: audit, sessions, role approvals.',
    permissions: ['audit.read', 'user.approve', 'integration.read'],
  },
  {
    code: 'INTERNAL_AUDITOR',
    name: 'Internal Auditor',
    scope: 'STAFF',
    description: 'Read-only audit and reporting access.',
    permissions: ['audit.read', 'report.read', 'application.read', 'policy.read', 'partner.read'],
  },
  {
    code: 'BANK_DEVELOPER',
    name: 'Developer',
    scope: 'STAFF',
    description: 'Integration health and logs (no customer data).',
    permissions: ['integration.read'],
  },
  {
    code: 'MANAGEMENT_READONLY',
    name: 'Read-only Management User',
    scope: 'STAFF',
    description: 'Executive dashboards and reports.',
    permissions: ['report.read', 'partner.read'],
  },
];

export const PARTNER_ROLES: RoleDefinition[] = [
  {
    code: 'PARTNER_ADMIN',
    name: 'Partner Administrator',
    scope: 'PARTNER',
    description: 'Full partner portal access including team and integration management.',
    permissions: [
      'p.dashboard.read', 'p.application.read', 'p.fulfilment.manage', 'p.settlement.read', 'p.refund.request',
      'p.integration.manage', 'p.integration.read', 'p.team.manage', 'p.report.export',
    ],
  },
  {
    code: 'PARTNER_FINANCE',
    name: 'Finance Officer',
    scope: 'PARTNER',
    description: 'Settlements and reports.',
    permissions: ['p.dashboard.read', 'p.application.read', 'p.settlement.read', 'p.report.export'],
  },
  {
    code: 'PARTNER_FULFILMENT',
    name: 'Fulfilment Officer',
    scope: 'PARTNER',
    description: 'Release queue, dispatch and delivery confirmation.',
    permissions: ['p.dashboard.read', 'p.application.read', 'p.fulfilment.manage', 'p.refund.request'],
  },
  {
    code: 'PARTNER_SUPPORT',
    name: 'Customer Support',
    scope: 'PARTNER',
    description: 'Application status lookups for customer queries.',
    permissions: ['p.dashboard.read', 'p.application.read'],
  },
  {
    code: 'PARTNER_DEVELOPER',
    name: 'Developer',
    scope: 'PARTNER',
    description: 'API credentials, webhooks and logs.',
    permissions: ['p.dashboard.read', 'p.integration.manage', 'p.integration.read'],
  },
  {
    code: 'PARTNER_VIEWER',
    name: 'Read-only Viewer',
    scope: 'PARTNER',
    description: 'Read-only dashboard access.',
    permissions: ['p.dashboard.read', 'p.application.read', 'p.settlement.read'],
  },
];

export const API_SCOPES = {
  'checkout:write': 'Create checkout sessions',
  'checkout:read': 'Read checkout sessions',
  'applications:read': 'Read application status',
  'orders:read': 'Read orders and release authorisations',
  'orders:write': 'Confirm fulfilment, delivery, cancellation and returns',
  'settlements:read': 'Read settlements',
  'webhooks:read': 'Read webhook events',
  'webhooks:write': 'Retry webhook events',
} as const;

export type ApiScope = keyof typeof API_SCOPES;
export const ALL_API_SCOPES = Object.keys(API_SCOPES) as ApiScope[];
