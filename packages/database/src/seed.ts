/**
 * Sandbox seed. Creates RBAC, the PROPOSED credit policy, notification templates and
 * synthetic staff accounts. Refuses to run in production.
 *
 * Demo staff accounts use a shared sandbox password and pre-enrolled TOTP secrets so
 * reviewers can sign in with any authenticator app (or `pnpm totp <email>`).
 * These are SANDBOX-ONLY credentials and are documented in DEPLOYMENT.md.
 */
import { BANK_ROLES, PARTNER_ROLES, PERMISSIONS, SENSITIVE_PERMISSIONS } from '@araf/types';
import { PROPOSED_SANDBOX_POLICY } from '@araf/business-rules';
import { FieldEncryptor, base32Encode, hashPassword, sha256Hex } from '@araf/security';
import { createPrismaClient, POLICY_CODE } from './index';

export const SANDBOX_STAFF_PASSWORD = 'Sandbox-Pass-2026!';
export const SANDBOX_STAFF_DOMAIN = 'sandbox.altbank.example';

export const SANDBOX_STAFF: Array<{ email: string; name: string; roles: string[] }> = [
  { email: `superadmin@${SANDBOX_STAFF_DOMAIN}`, name: 'Sade Superadmin', roles: ['SUPER_ADMIN'] },
  { email: `business@${SANDBOX_STAFF_DOMAIN}`, name: 'Bayo Business', roles: ['BUSINESS_ADMIN'] },
  { email: `onboarding@${SANDBOX_STAFF_DOMAIN}`, name: 'Ola Onboarding', roles: ['PARTNER_ONBOARDING_OFFICER'] },
  { email: `partner.approver@${SANDBOX_STAFF_DOMAIN}`, name: 'Pat Approver', roles: ['PARTNER_APPROVING_OFFICER'] },
  { email: `analyst@${SANDBOX_STAFF_DOMAIN}`, name: 'Ada Analyst', roles: ['CREDIT_ANALYST'] },
  { email: `risk@${SANDBOX_STAFF_DOMAIN}`, name: 'Rita Risk', roles: ['CREDIT_RISK_REVIEWER'] },
  { email: `approver@${SANDBOX_STAFF_DOMAIN}`, name: 'Charles Approver', roles: ['CREDIT_APPROVER'] },
  { email: `cad@${SANDBOX_STAFF_DOMAIN}`, name: 'Cyril CAD', roles: ['CAD_OFFICER'] },
  { email: `settlement@${SANDBOX_STAFF_DOMAIN}`, name: 'Sam Settlement', roles: ['SETTLEMENT_OFFICER'] },
  { email: `finance@${SANDBOX_STAFF_DOMAIN}`, name: 'Fola Finance', roles: ['FINANCE_OFFICER'] },
  { email: `ops@${SANDBOX_STAFF_DOMAIN}`, name: 'Opeyemi Operations', roles: ['OPERATIONS_OFFICER'] },
  { email: `cx@${SANDBOX_STAFF_DOMAIN}`, name: 'Chidi Experience', roles: ['CX_OFFICER'] },
  { email: `compliance@${SANDBOX_STAFF_DOMAIN}`, name: 'Comfort Compliance', roles: ['COMPLIANCE_OFFICER'] },
  { email: `infosec@${SANDBOX_STAFF_DOMAIN}`, name: 'Ini Infosec', roles: ['INFOSEC_OFFICER'] },
  { email: `auditor@${SANDBOX_STAFF_DOMAIN}`, name: 'Audu Auditor', roles: ['INTERNAL_AUDITOR'] },
  { email: `developer@${SANDBOX_STAFF_DOMAIN}`, name: 'Dayo Developer', roles: ['BANK_DEVELOPER'] },
  { email: `management@${SANDBOX_STAFF_DOMAIN}`, name: 'Mojisola Management', roles: ['MANAGEMENT_READONLY'] },
];

/** Deterministic sandbox TOTP secret per demo email (sandbox only, documented). */
export function sandboxTotpSecret(email: string): string {
  return base32Encode(Buffer.from(sha256Hex(`araf-sandbox-totp:${email}`).slice(0, 40), 'hex'));
}

const TEMPLATES: Array<{ code: string; channel: string; audience: string; subject: string; body: string }> = [
  { code: 'IDENTITY_OTP', channel: 'SMS', audience: 'CUSTOMER', subject: 'Pay with ARAF verification code', body: 'Your Pay with ARAF code is {{code}}. It expires in 5 minutes. Never share this code. The Alternative Bank will never ask for it.' },
  { code: 'ADDITIONAL_INFO_REQUIRED', channel: 'EMAIL', audience: 'CUSTOMER', subject: 'More information needed for your financing application', body: 'Your application {{reference}} needs a little more information. Continue securely from your Pay with ARAF link.' },
  { code: 'ACCOUNT_OPENING_PENDING', channel: 'EMAIL', audience: 'CUSTOMER', subject: 'Complete your account opening', body: 'Complete your Alternative Bank account opening to continue application {{reference}}.' },
  { code: 'ANALYSIS_COMPLETED', channel: 'EMAIL', audience: 'CUSTOMER', subject: 'Your statement review is complete', body: 'We have finished reviewing your statement for application {{reference}}. Return to Pay with ARAF to see your options.' },
  { code: 'APPLICATION_SUBMITTED', channel: 'EMAIL', audience: 'CUSTOMER', subject: 'Financing application received', body: 'Application {{reference}} has been received for review. It is not yet approved. We will update you.' },
  { code: 'FINANCING_APPROVED', channel: 'EMAIL', audience: 'CUSTOMER', subject: 'Financing approved — next steps', body: 'Application {{reference}} has been approved. Please review and sign your financing documents.' },
  { code: 'EQUITY_PAYABLE', channel: 'EMAIL', audience: 'CUSTOMER', subject: 'Pay your equity to the merchant', body: 'Application {{reference}} is approved. Please pay your agreed equity to the merchant; the Bank finances only the remaining amount.' },
  { code: 'EQUITY_CONFIRMED', channel: 'EMAIL', audience: 'CUSTOMER', subject: 'Equity received', body: 'The merchant has confirmed receipt of your equity for application {{reference}}.' },
  { code: 'FINANCING_DECLINED', channel: 'EMAIL', audience: 'CUSTOMER', subject: 'Update on your financing application', body: 'We are unable to offer financing for application {{reference}} at this time. You can choose another payment method with the merchant.' },
  { code: 'DOCUMENTATION_REQUIRED', channel: 'EMAIL', audience: 'CUSTOMER', subject: 'Action required: financing documents', body: 'Please review and sign the documents for application {{reference}}.' },
  { code: 'VENDOR_PAYMENT_CONFIRMED', channel: 'EMAIL', audience: 'CUSTOMER', subject: 'We have purchased your item', body: 'The Bank has purchased your item for application {{reference}}. Please review and execute your sale agreement.' },
  { code: 'GOODS_DISPATCHED', channel: 'EMAIL', audience: 'CUSTOMER', subject: 'Your item is on its way', body: 'Your item for application {{reference}} has been dispatched.' },
  { code: 'GOODS_DELIVERED', channel: 'EMAIL', audience: 'CUSTOMER', subject: 'Your item has been delivered', body: 'Your item for application {{reference}} has been delivered. Repayments follow your agreed schedule.' },
  { code: 'PARTNER_NEW_APPLICATION', channel: 'IN_APP', audience: 'PARTNER', subject: 'New financing application', body: 'Application {{reference}} was created for order {{order}}.' },
  { code: 'PARTNER_STATUS_CHANGE', channel: 'IN_APP', audience: 'PARTNER', subject: 'Application status changed', body: 'Application {{reference}} is now {{status}}.' },
  { code: 'PARTNER_RELEASE_AUTHORIZED', channel: 'IN_APP', audience: 'PARTNER', subject: 'Goods release authorised', body: 'Release {{release}} authorised for order {{order}}. You may release the goods.' },
  { code: 'PARTNER_RELEASE_SUSPENDED', channel: 'IN_APP', audience: 'PARTNER', subject: 'Goods release SUSPENDED', body: 'Release for order {{order}} is suspended. Do not release the goods.' },
  { code: 'BANK_MANUAL_REVIEW', channel: 'IN_APP', audience: 'BANK', subject: 'Manual review required', body: 'Application {{reference}} entered the {{queue}} queue.' },
  { code: 'BANK_EXCEPTION', channel: 'IN_APP', audience: 'BANK', subject: 'Operational exception', body: 'Exception {{exception}} ({{code}}) raised for {{team}}.' },
];

async function main() {
  const appEnv = process.env.APP_ENV ?? 'local';
  if (appEnv === 'production') throw new Error('Refusing to seed synthetic data into a production environment.');
  const prisma = createPrismaClient();
  const keys = JSON.parse(process.env.ENCRYPTION_KEYS ?? '{}') as Record<string, string>;
  const encryptor = new FieldEncryptor(keys, process.env.ENCRYPTION_ACTIVE_KEY ?? 'k1');

  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { code },
      update: { description, sensitive: SENSITIVE_PERMISSIONS.includes(code as never) },
      create: { code, description, sensitive: SENSITIVE_PERMISSIONS.includes(code as never) },
    });
  }
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.code, p.id]));
  for (const role of [...BANK_ROLES, ...PARTNER_ROLES]) {
    const r = await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description, scope: role.scope },
      create: { code: role.code, name: role.name, description: role.description, scope: role.scope },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: r.id } });
    await prisma.rolePermission.createMany({ data: role.permissions.map((p) => ({ roleId: r.id, permissionId: perms.get(p)! })) });
  }

  const policy = await prisma.creditPolicy.upsert({
    where: { code: POLICY_CODE },
    update: {},
    create: {
      code: POLICY_CODE,
      name: 'Retail asset financing (Murabaha) — Pay with ARAF',
      description: 'PROPOSED policy derived from the SeedFi SWR. Subject to Credit Risk, Legal and Shariah approval before production.',
    },
  });
  const active = await prisma.creditPolicyVersion.findFirst({ where: { policyId: policy.id, status: 'ACTIVE' } });
  // Sandbox databases seeded before per-annum product pricing hold a legacy version (25% / 50% total
  // markup tiers, no equity, business owners always manual). Supersede it with the current PROPOSED rules.
  if (active && !('defaultAnnualProfitRateBps' in (active.rules as object))) {
    const last = await prisma.creditPolicyVersion.findFirst({ where: { policyId: policy.id }, orderBy: { version: 'desc' } });
    await prisma.creditPolicyVersion.update({ where: { id: active.id }, data: { status: 'SUPERSEDED' } });
    await prisma.creditPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: (last?.version ?? active.version) + 1,
        status: 'ACTIVE',
        rules: PROPOSED_SANDBOX_POLICY as object,
        changeSummary: 'PROPOSED (sandbox): profit priced per annum per product (default 25% p.a.), 24-month maximum tenor, business owners assessed at 10% of monthly turnover, customer equity paid to the merchant reduces the financed amount.',
        isProposed: true,
        effectiveFrom: new Date(),
        approvedAt: new Date(),
      },
    });
  }
  if (!active) {
    await prisma.creditPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        status: 'ACTIVE',
        rules: PROPOSED_SANDBOX_POLICY as object,
        changeSummary: 'Initial PROPOSED sandbox policy (score bands 280–529 / 530–619 / 620–800, 33.3% of salary / 10% of turnover, ₦5m single obligor, 25% p.a. default product rate, 24-month maximum tenor, customer equity enabled).',
        isProposed: true,
        effectiveFrom: new Date(),
        approvedAt: new Date(),
      },
    });
  }

  for (const t of TEMPLATES) {
    await prisma.notificationTemplate.upsert({
      where: { code_channel_version: { code: t.code, channel: t.channel, version: 1 } },
      update: { subject: t.subject, body: t.body, audience: t.audience },
      create: { ...t, version: 1 },
    });
  }

  const passwordHash = await hashPassword(SANDBOX_STAFF_PASSWORD);
  const roles = new Map((await prisma.role.findMany()).map((r) => [r.code, r.id]));
  for (const s of SANDBOX_STAFF) {
    const user = await prisma.user.upsert({
      where: { email: s.email },
      update: {},
      create: { email: s.email, fullName: s.name, type: 'STAFF', status: 'ACTIVE', passwordHash },
    });
    for (const code of s.roles) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: roles.get(code)! } },
        update: {},
        create: { userId: user.id, roleId: roles.get(code)! },
      });
    }
    const mfa = await prisma.mfaCredential.findFirst({ where: { userId: user.id } });
    if (!mfa) {
      await prisma.mfaCredential.create({
        data: { userId: user.id, type: 'TOTP', secretEncrypted: encryptor.encrypt(sandboxTotpSecret(s.email), `mfa:${user.id}`), verifiedAt: new Date() },
      });
    }
  }
  await prisma.$disconnect();
  console.log(`Seeded ${SANDBOX_STAFF.length} sandbox staff users, ${roles.size} roles, ${perms.size} permissions, credit policy, ${TEMPLATES.length} templates.`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
