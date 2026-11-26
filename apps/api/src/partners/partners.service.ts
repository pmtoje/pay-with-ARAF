import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { assertTransition } from '@araf/business-rules';
import { generateApiKey, generateWebhookSecret, maskAccountNumber, randomToken, validateUrlSyntax, UnsafeUrlError } from '@araf/security';
import { ALL_API_SCOPES, ALL_WEBHOOK_EVENT_TYPES, PARTNER_ROLES, type ApiScope, PARTNER_PORTAL_MODULES, effectivePortalSettings, partnerPortalSettingsSchema, type PartnerPortalModule } from '@araf/types';
import type { ApprovalRequest, PartnerStatus } from '@araf/database';
import { CONFIG, type AppConfig } from '../config';
import { AppError, fail } from '../common/errors';
import { CryptoService } from '../common/crypto.service';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AuditService, ReferenceService, type Actor } from '../common/core.services';
import { ProvidersService } from '../common/providers.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { WebhooksService } from '../webhooks/webhooks.service';

const text = (max = 200) => z.string().trim().min(1).max(max);
const naira = z.number().int().positive();

export const partnerInputSchema = z
  .object({
    registered_name: text(),
    trading_name: text(),
    registration_number: text(40),
    business_type: text(80),
    partner_type: z.enum(['DIRECT_MERCHANT', 'MARKETPLACE']),
    website_url: z.string().url().max(300),
    business_address: text(400),
    business_category: text(80),
    tax_identification_number: z.string().trim().max(40).optional(),
    contact_name: text(120),
    contact_email: z.string().email().max(254),
    contact_phone: z.string().regex(/^\+?\d{10,15}$/),
    technical_contact_name: z.string().trim().max(120).optional(),
    technical_contact_email: z.string().email().max(254).optional(),
    risk_classification: z.enum(['LOW', 'MEDIUM', 'HIGH', 'UNCLASSIFIED']).default('UNCLASSIFIED'),
  })
  .strict();

export const configInputSchema = z
  .object({
    min_transaction_naira: naira,
    max_transaction_naira: naira,
    permitted_products: z.array(z.enum(['MURABAHA_ASSET_FINANCING'])).min(1),
    permitted_tenors: z.array(z.number().int().positive()).min(1),
    eligible_categories: z.array(z.string().trim().min(1).max(64)).min(1),
    application_expiry_minutes: z.number().int().min(30).max(60 * 24 * 30),
    order_reservation_minutes: z.number().int().min(30).max(60 * 24 * 30),
    /** Customer equity: the customer may pay part of the price to the merchant; only the remainder is financed. */
    partial_financing_enabled: z.boolean(),
    /** Product pricing: profit rate per annum, in percent with up to 2 decimals (25 = 25% p.a.). */
    annual_profit_rate_percent: z.number().min(0).max(100).refine((v) => Number.isInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, 'At most 2 decimal places').default(25),
    allow_multiple_vendors: z.boolean(),
    settlement_arrangement: z.enum(['DIRECT_TO_VENDOR', 'TO_MARKETPLACE']),
    return_url_origins: z.array(z.string().url()).min(1).max(10),
  })
  .strict()
  .refine((c) => c.max_transaction_naira >= c.min_transaction_naira, { message: 'Maximum must be at least the minimum', path: ['max_transaction_naira'] });

export const vendorInputSchema = z
  .object({
    vendor_reference: z.string().regex(/^[A-Za-z0-9._\-]{1,64}$/),
    name: text(),
    registration_number: z.string().trim().max(40).optional(),
    categories: z.array(z.string().trim().min(1).max(64)).min(1),
  })
  .strict();

export const settlementAccountSchema = z
  .object({
    bank_code: z.string().regex(/^\d{3,6}$/),
    bank_name: text(80),
    account_number: z.string().regex(/^\d{10}$/),
    account_name: text(120),
  })
  .strict();

export const webhookEndpointSchema = z
  .object({ url: z.string().url().max(500), description: z.string().max(200).optional(), events: z.array(z.enum(ALL_WEBHOOK_EVENT_TYPES as [string, ...string[]])).default([]) })
  .strict();

export const credentialSchema = z
  .object({
    name: text(80),
    scopes: z.array(z.enum(ALL_API_SCOPES as [ApiScope, ...ApiScope[]])).min(1),
    ip_allowlist: z.array(z.union([z.ipv4(), z.ipv6()])).max(20).default([]),
    expires_in_days: z.number().int().min(1).max(730).optional(),
  })
  .strict();

const N = (n: number) => BigInt(n) * 100n;

@Injectable()
export class PartnersService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly refs: ReferenceService,
    private readonly approvals: ApprovalsService,
    private readonly providers: ProvidersService,
    private readonly webhooks: WebhooksService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.approvals.register('PARTNER_APPROVAL', {
      onApprove: (tx, req, checker) => this.provision(tx, req, checker),
      onReject: async (tx, req, checker) => {
        const decision = (req.payload as { requestedDecision?: string })?.requestedDecision;
        await this.setStatus(tx, req.resourceId, decision === 'REQUEST_INFO' ? 'ADDITIONAL_INFORMATION_REQUIRED' : 'REJECTED', checker, req.checkerComment ?? undefined, req.id);
        if (decision !== 'REQUEST_INFO') await tx.partnerConfiguration.updateMany({ where: { partnerId: req.resourceId, status: 'PENDING_APPROVAL' }, data: { status: 'REJECTED' } });
      },
    });
    this.approvals.register('PARTNER_CONFIG', {
      onApprove: async (tx, req, checker) => this.activateConfig(tx, req.resourceId, req.partnerId!, checker),
      onReject: async (tx, req) => {
        await tx.partnerConfiguration.update({ where: { id: req.resourceId }, data: { status: 'REJECTED' } });
      },
    });
    this.approvals.register('PARTNER_PORTAL', {
      onApprove: async (tx, req) => {
        const settings = partnerPortalSettingsSchema.parse((req.payload as { settings: unknown }).settings);
        await tx.partner.update({ where: { id: req.resourceId }, data: { portalSettings: settings as object } });
      },
    });
    this.approvals.register('PARTNER_PRODUCTION', {
      onApprove: async (tx, req, checker) => {
        if (!this.config.LIVE_OPERATIONS_ENABLED || this.config.PLATFORM_ENVIRONMENT !== 'PRODUCTION') throw new AppError('PRODUCTION_LOCKED');
        await this.setStatus(tx, req.resourceId, 'PRODUCTION_ACTIVE', checker, req.checkerComment ?? undefined, req.id);
      },
      onReject: async (tx, req, checker) => this.setStatus(tx, req.resourceId, 'SANDBOX_ACTIVE', checker, req.checkerComment ?? undefined, req.id),
    });
    this.approvals.register('PARTNER_REACTIVATION', {
      onApprove: async (tx, req, checker) => this.setStatus(tx, req.resourceId, (req.payload as { target: PartnerStatus }).target, checker, req.checkerComment ?? undefined, req.id),
    });
    this.approvals.register('VENDOR_ACCOUNT', {
      onApprove: async (tx, req) => {
        const acct = await tx.vendorSettlementAccount.findUniqueOrThrow({ where: { id: req.resourceId } });
        if (acct.verificationStatus !== 'VERIFIED') throw new AppError('PRECONDITIONS_NOT_MET', { reason: 'Account name enquiry did not verify' });
        await tx.vendorSettlementAccount.updateMany({ where: { vendorId: acct.vendorId, status: 'ACTIVE' }, data: { status: 'SUSPENDED' } });
        await tx.vendorSettlementAccount.update({ where: { id: acct.id }, data: { status: 'ACTIVE', approvalId: req.id } });
        await tx.vendor.update({ where: { id: acct.vendorId }, data: { status: 'APPROVED' } });
      },
      onReject: async (tx, req) => {
        await tx.vendorSettlementAccount.update({ where: { id: req.resourceId }, data: { status: 'REJECTED' } });
      },
    });
  }

  // ---- Queries ------------------------------------------------------------------------

  async list(filter: { status?: string; q?: string }) {
    const rows = await this.prisma.partner.findMany({
      where: {
        status: (filter.status as PartnerStatus) || undefined,
        OR: filter.q ? [{ tradingName: { contains: filter.q, mode: 'insensitive' } }, { partnerCode: { contains: filter.q, mode: 'insensitive' } }] : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
    const counts = await this.prisma.financingApplication.groupBy({ by: ['partnerId'], _count: { _all: true }, where: { environment: this.config.PLATFORM_ENVIRONMENT } });
    const countMap = new Map(counts.map((c) => [c.partnerId, c._count._all]));
    return rows.map((p) => ({
      id: p.id,
      partner_code: p.partnerCode,
      trading_name: p.tradingName,
      registered_name: p.registeredName,
      partner_type: p.partnerType,
      business_category: p.businessCategory,
      status: p.status,
      risk_classification: p.riskClassification,
      applications: countMap.get(p.id) ?? 0,
      created_at: p.createdAt,
    }));
  }

  async detail(id: string) {
    const p = await this.prisma.partner.findUnique({
      where: { id },
      include: {
        configurations: { orderBy: { version: 'desc' } },
        domains: true,
        vendors: { include: { settlementAccounts: { orderBy: { createdAt: 'desc' } } } },
        statusHistory: { orderBy: { createdAt: 'desc' } },
        webhookEndpoints: { select: { id: true, url: true, environment: true, status: true, events: true, consecutiveFailures: true, createdAt: true } },
        credentials: { select: { id: true, name: true, environment: true, lookupPrefix: true, last4: true, status: true, scopes: true, lastUsedAt: true, createdAt: true, expiresAt: true } },
        users: { select: { id: true, email: true, fullName: true, status: true, lastLoginAt: true, roles: { include: { role: true } } } },
      },
    });
    if (!p) throw new AppError('NOT_FOUND');
    const approvals = await this.prisma.approvalRequest.findMany({ where: { partnerId: id }, orderBy: { createdAt: 'desc' } });
    return {
      ...this.presentPartner(p),
      configurations: p.configurations.map((c) => this.presentConfig(c)),
      domains: p.domains.map((d) => ({ id: d.id, environment: d.environment, kind: d.kind, value: d.value, approved: d.approved })),
      portal: await this.portalSettingsView(id),
      checkout: {
        sdk_url: `${this.config.CHECKOUT_BASE_URL}/v1/araf.js`,
        api_base_url: `${this.config.PUBLIC_API_URL}/api/v1`,
        button_label: 'Buy Now Pay Later with AltBank',
        embed_origins: p.domains.filter((d) => d.kind === 'RETURN_URL_ORIGIN' && d.approved).map((d) => d.value),
        pending_origins: p.domains.filter((d) => d.kind === 'RETURN_URL_ORIGIN' && !d.approved).map((d) => d.value),
      },
      vendors: p.vendors.map((v) => ({
        id: v.id,
        vendor_reference: v.vendorReference,
        name: v.name,
        categories: v.categories,
        status: v.status,
        is_partner_itself: v.isPartnerItself,
        settlement_accounts: v.settlementAccounts.map((a) => ({
          id: a.id,
          bank_name: a.bankName,
          bank_code: a.bankCode,
          account_number_masked: a.accountNumberMasked,
          account_name: a.accountName,
          verified_name: a.verifiedName,
          verification_status: a.verificationStatus,
          status: a.status,
        })),
      })),
      status_history: p.statusHistory.map((h) => ({ from: h.fromStatus, to: h.toStatus, reason: h.reason, at: h.createdAt })),
      webhook_endpoints: p.webhookEndpoints,
      credentials: p.credentials,
      users: p.users.map((u) => ({ id: u.id, email: u.email, full_name: u.fullName, status: u.status, last_login_at: u.lastLoginAt, roles: u.roles.map((r) => r.role.code) })),
      approvals: approvals.map((a) => ({ id: a.id, reference: a.reference, type: a.type, status: a.status, summary: a.summary, created_at: a.createdAt, decided_at: a.decidedAt, checker_comment: a.checkerComment })),
    };
  }

  presentPartner(p: { id: string; partnerCode: string; registeredName: string; tradingName: string; registrationNumber: string; businessType: string; partnerType: string; websiteUrl: string; businessAddress: string; businessCategory: string; taxIdentificationNumber: string | null; contactName: string; contactEmail: string; contactPhone: string; technicalContactName: string | null; technicalContactEmail: string | null; riskClassification: string; status: string; createdAt: Date }) {
    return {
      id: p.id,
      partner_code: p.partnerCode,
      registered_name: p.registeredName,
      trading_name: p.tradingName,
      registration_number: p.registrationNumber,
      business_type: p.businessType,
      partner_type: p.partnerType,
      website_url: p.websiteUrl,
      business_address: p.businessAddress,
      business_category: p.businessCategory,
      tax_identification_number: p.taxIdentificationNumber,
      contact_name: p.contactName,
      contact_email: p.contactEmail,
      contact_phone: p.contactPhone,
      technical_contact_name: p.technicalContactName,
      technical_contact_email: p.technicalContactEmail,
      risk_classification: p.riskClassification,
      status: p.status,
      created_at: p.createdAt,
    };
  }

  presentConfig(c: { id: string; version: number; status: string; minTransactionKobo: bigint; maxTransactionKobo: bigint; permittedProducts: string[]; permittedTenors: number[]; eligibleCategories: string[]; applicationExpiryMinutes: number; orderReservationMinutes: number; partialFinancingEnabled: boolean; annualProfitRateBps: number; allowMultipleVendors: boolean; settlementArrangement: string; sandboxEnabled: boolean; productionEnabled: boolean; approvedAt: Date | null; createdAt: Date }) {
    return {
      id: c.id,
      version: c.version,
      status: c.status,
      min_transaction_kobo: Number(c.minTransactionKobo),
      max_transaction_kobo: Number(c.maxTransactionKobo),
      permitted_products: c.permittedProducts,
      permitted_tenors: c.permittedTenors,
      eligible_categories: c.eligibleCategories,
      application_expiry_minutes: c.applicationExpiryMinutes,
      order_reservation_minutes: c.orderReservationMinutes,
      partial_financing_enabled: c.partialFinancingEnabled,
      customer_equity_enabled: c.partialFinancingEnabled,
      annual_profit_rate_percent: c.annualProfitRateBps / 100,
      allow_multiple_vendors: c.allowMultipleVendors,
      settlement_arrangement: c.settlementArrangement,
      sandbox_enabled: c.sandboxEnabled,
      production_enabled: c.productionEnabled,
      approved_at: c.approvedAt,
      created_at: c.createdAt,
    };
  }

  // ---- Onboarding lifecycle --------------------------------------------------------------

  async create(body: unknown, actor: Actor) {
    const input = partnerInputSchema.parse(body);
    const partnerCode = await this.refs.next('PTN');
    const partner = await this.prisma.$transaction(async (tx) => {
      const p = await tx.partner.create({
        data: {
          partnerCode,
          registeredName: input.registered_name,
          tradingName: input.trading_name,
          registrationNumber: input.registration_number,
          businessType: input.business_type,
          partnerType: input.partner_type,
          websiteUrl: input.website_url,
          businessAddress: input.business_address,
          businessCategory: input.business_category,
          taxIdentificationNumber: input.tax_identification_number,
          contactName: input.contact_name,
          contactEmail: input.contact_email.toLowerCase(),
          contactPhone: input.contact_phone,
          technicalContactName: input.technical_contact_name,
          technicalContactEmail: input.technical_contact_email?.toLowerCase(),
          riskClassification: input.risk_classification,
          status: 'DRAFT',
          createdById: actor.id,
        },
      });
      await tx.partnerStatusHistory.create({ data: { partnerId: p.id, toStatus: 'DRAFT', actorId: actor.id, reason: 'Created' } });
      await tx.partnerDomain.create({ data: { partnerId: p.id, environment: this.config.PLATFORM_ENVIRONMENT, kind: 'WEBSITE', value: new URL(input.website_url).origin } });
      // Direct merchants are their own supplier/beneficiary.
      if (input.partner_type === 'DIRECT_MERCHANT') {
        await tx.vendor.create({ data: { partnerId: p.id, environment: this.config.PLATFORM_ENVIRONMENT, vendorReference: 'SELF', name: input.trading_name, categories: [], isPartnerItself: true } });
      }
      await this.audit.record(actor, { action: 'partner.created', resourceType: 'PARTNER', resourceId: p.id, partnerId: p.id, after: input }, tx);
      return p;
    });
    return { id: partner.id, partner_code: partner.partnerCode, status: partner.status };
  }

  async update(id: string, body: unknown, actor: Actor) {
    const input = partnerInputSchema.partial().parse(body);
    const p = await this.prisma.partner.findUnique({ where: { id } });
    if (!p) throw new AppError('NOT_FOUND');
    if (!['DRAFT', 'ADDITIONAL_INFORMATION_REQUIRED'].includes(p.status)) throw new AppError('INVALID_STATE', undefined, 'Partner details can only be edited before approval. Use a configuration change request afterwards.');
    await this.prisma.$transaction(async (tx) => {
      await tx.partner.update({
        where: { id },
        data: {
          registeredName: input.registered_name,
          tradingName: input.trading_name,
          registrationNumber: input.registration_number,
          businessType: input.business_type,
          partnerType: input.partner_type,
          websiteUrl: input.website_url,
          businessAddress: input.business_address,
          businessCategory: input.business_category,
          taxIdentificationNumber: input.tax_identification_number,
          contactName: input.contact_name,
          contactEmail: input.contact_email?.toLowerCase(),
          contactPhone: input.contact_phone,
          technicalContactName: input.technical_contact_name,
          technicalContactEmail: input.technical_contact_email?.toLowerCase(),
          riskClassification: input.risk_classification,
        },
      });
      await this.audit.record(actor, { action: 'partner.updated', resourceType: 'PARTNER', resourceId: id, partnerId: id, before: this.presentPartner(p), after: input }, tx);
    });
    return { ok: true };
  }

  async proposeConfiguration(partnerId: string, body: unknown, actor: Actor) {
    const input = configInputSchema.parse(body);
    const partner = await this.prisma.partner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new AppError('NOT_FOUND');
    if (['REJECTED', 'TERMINATED'].includes(partner.status)) throw new AppError('INVALID_STATE');
    const policy = await this.activePolicyRules();
    const badTenors = input.permitted_tenors.filter((t) => !policy.approvedTenorsMonths.includes(t));
    if (badTenors.length) fail('VALIDATION_FAILED', { fields: [{ path: 'permitted_tenors', message: `Not approved by the active credit policy: ${badTenors.join(', ')}` }] });
    const longTenors = input.permitted_tenors.filter((t) => t > policy.maxTenorMonths);
    if (longTenors.length) fail('VALIDATION_FAILED', { fields: [{ path: 'permitted_tenors', message: `Tenors cannot exceed ${policy.maxTenorMonths} months: ${longTenors.join(', ')}` }] });
    if (input.partial_financing_enabled && !policy.customerEquityEnabled) {
      fail('VALIDATION_FAILED', { fields: [{ path: 'partial_financing_enabled', message: 'Customer equity is disabled by the active credit policy.' }] });
    }
    for (const o of input.return_url_origins) {
      const u = new URL(o);
      if (u.protocol !== 'https:' && !this.config.WEBHOOK_ALLOW_PRIVATE_NETWORKS) fail('VALIDATION_FAILED', { fields: [{ path: 'return_url_origins', message: 'Return URLs must use HTTPS' }] });
    }
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.partnerConfiguration.updateMany({ where: { partnerId, status: 'PENDING_APPROVAL' }, data: { status: 'SUPERSEDED' } });
      const last = await tx.partnerConfiguration.findFirst({ where: { partnerId }, orderBy: { version: 'desc' } });
      const cfg = await tx.partnerConfiguration.create({
        data: {
          partnerId,
          version: (last?.version ?? 0) + 1,
          status: 'PENDING_APPROVAL',
          minTransactionKobo: N(input.min_transaction_naira),
          maxTransactionKobo: N(input.max_transaction_naira),
          permittedProducts: input.permitted_products,
          permittedTenors: [...input.permitted_tenors].sort((a, b) => a - b),
          eligibleCategories: input.eligible_categories.map((c) => c.toLowerCase()),
          applicationExpiryMinutes: input.application_expiry_minutes,
          orderReservationMinutes: input.order_reservation_minutes,
          partialFinancingEnabled: input.partial_financing_enabled,
          annualProfitRateBps: Math.round(input.annual_profit_rate_percent * 100),
          allowMultipleVendors: input.allow_multiple_vendors,
          settlementArrangement: input.settlement_arrangement,
          makerId: actor.id,
        },
      });
      for (const origin of input.return_url_origins.map((o) => new URL(o).origin)) {
        await tx.partnerDomain.upsert({
          where: { partnerId_environment_kind_value: { partnerId, environment: this.config.PLATFORM_ENVIRONMENT, kind: 'RETURN_URL_ORIGIN', value: origin } },
          create: { partnerId, environment: this.config.PLATFORM_ENVIRONMENT, kind: 'RETURN_URL_ORIGIN', value: origin, approved: false },
          update: {},
        });
      }
      await this.audit.record(actor, { action: 'partner.configuration_proposed', resourceType: 'PARTNER_CONFIGURATION', resourceId: cfg.id, partnerId, after: input }, tx);
      // Once a partner is live, every configuration change goes through its own maker-checker request.
      if (!['DRAFT', 'ADDITIONAL_INFORMATION_REQUIRED', 'SUBMITTED', 'UNDER_REVIEW'].includes(partner.status)) {
        await this.approvals.create(tx, { type: 'PARTNER_CONFIG', resourceType: 'PARTNER_CONFIGURATION', resourceId: cfg.id, partnerId, payload: { version: cfg.version, annual_profit_rate_percent: input.annual_profit_rate_percent, customer_equity_enabled: input.partial_financing_enabled, permitted_tenors: cfg.permittedTenors }, summary: `Configuration v${cfg.version} for ${partner.tradingName} — ${input.annual_profit_rate_percent}% p.a., tenors up to ${Math.max(...cfg.permittedTenors)} months` }, actor);
      }
      return cfg;
    });
    return this.presentConfig(result);
  }

  private async activateConfig(tx: Tx, configId: string, partnerId: string, checker: Actor) {
    const cfg = await tx.partnerConfiguration.findUniqueOrThrow({ where: { id: configId } });
    if (cfg.makerId === checker.id) throw new AppError('MAKER_CHECKER_VIOLATION');
    await tx.partnerConfiguration.updateMany({ where: { partnerId, status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } });
    await tx.partnerConfiguration.update({ where: { id: configId }, data: { status: 'ACTIVE', checkerId: checker.id, approvedAt: new Date() } });
    await tx.partnerDomain.updateMany({ where: { partnerId }, data: { approved: true } });
  }

  async submit(id: string, comment: string | undefined, actor: Actor) {
    const p = await this.prisma.partner.findUnique({ where: { id }, include: { configurations: { where: { status: 'PENDING_APPROVAL' } }, vendors: { include: { settlementAccounts: true } } } });
    if (!p) throw new AppError('NOT_FOUND');
    if (!p.configurations.length) fail('PRECONDITIONS_NOT_MET', { reason: 'A proposed configuration is required before submission.' });
    if (!p.vendors.some((v) => v.settlementAccounts.length)) fail('PRECONDITIONS_NOT_MET', { reason: 'At least one vendor settlement account is required.' });
    await this.prisma.$transaction(async (tx) => {
      await this.setStatus(tx, id, 'SUBMITTED', actor, comment);
      await this.setStatus(tx, id, 'UNDER_REVIEW', actor, 'Queued for approval');
      await this.approvals.create(tx, { type: 'PARTNER_APPROVAL', resourceType: 'PARTNER', resourceId: id, partnerId: id, payload: { configurationId: p.configurations[0].id }, summary: `Onboard ${p.tradingName} (${p.partnerCode})`, comment }, actor);
    });
    return { status: 'UNDER_REVIEW' };
  }

  /** Checker decision on onboarding: approve, reject, or request additional information. */
  async decideOnboarding(approvalId: string, decision: 'APPROVE' | 'REJECT' | 'REQUEST_INFO', comment: string, checker: Actor) {
    if (decision === 'REQUEST_INFO') {
      await this.prisma.approvalRequest.update({ where: { id: approvalId }, data: { payload: { requestedDecision: 'REQUEST_INFO' } } });
      return this.approvals.decide(approvalId, 'REJECT', comment, checker);
    }
    return this.approvals.decide(approvalId, decision, comment, checker);
  }

  async setStatus(tx: Tx, partnerId: string, to: PartnerStatus, actor: Actor, reason?: string, approvalId?: string) {
    const p = await tx.partner.findUniqueOrThrow({ where: { id: partnerId } });
    assertTransition('PARTNER', p.status, to);
    await tx.partner.update({ where: { id: partnerId }, data: { status: to } });
    await tx.partnerStatusHistory.create({ data: { partnerId, fromStatus: p.status, toStatus: to, actorId: actor.id, reason, approvalId } });
    await this.audit.record(actor, { action: 'partner.status_changed', resourceType: 'PARTNER', resourceId: partnerId, partnerId, before: { status: p.status }, after: { status: to }, reason }, tx);
  }

  /** Automatic provisioning on approval (spec §10.4). */
  private async provision(tx: Tx, req: ApprovalRequest, checker: Actor) {
    const partnerId = req.resourceId;
    const configId = (req.payload as { configurationId: string }).configurationId;
    const partner = await tx.partner.findUniqueOrThrow({ where: { id: partnerId } });
    await this.activateConfig(tx, configId, partnerId, checker);
    await this.setStatus(tx, partnerId, 'APPROVED', checker, req.checkerComment ?? undefined, req.id);
    // Webhook configuration profile: an inactive signing profile is created; the partner (or an
    // approved administrator) supplies the receiving URL. Signing secrets are generated by ARAF.
    // Initial partner administrator invitation.
    const existing = await tx.userInvitation.findFirst({ where: { partnerId, email: partner.contactEmail, acceptedAt: null, revokedAt: null } });
    if (!existing) {
      await this.createInvitation(tx, { email: partner.contactEmail, fullName: partner.contactName, type: 'PARTNER', partnerId, roleCodes: ['PARTNER_ADMIN'] }, checker);
    }
    await this.setStatus(tx, partnerId, 'SANDBOX_ACTIVE', checker, 'Sandbox environment provisioned', req.id);
  }

  async createInvitation(tx: Tx, input: { email: string; fullName: string; type: 'STAFF' | 'PARTNER'; partnerId?: string | null; roleCodes: string[] }, actor: Actor) {
    const token = randomToken('inv_', 40);
    await tx.userInvitation.create({
      data: {
        email: input.email.toLowerCase(),
        fullName: input.fullName,
        type: input.type,
        partnerId: input.partnerId ?? null,
        roleCodes: input.roleCodes,
        tokenHash: this.crypto.tokenHash(token),
        invitedById: actor.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
      },
    });
    const portal = input.type === 'STAFF' ? this.config.ADMIN_PORTAL_URL : this.config.PARTNER_PORTAL_URL;
    const link = `${portal}/invite/${token}`;
    // Sandbox: the invitation link is delivered to the sandbox inbox (email integration not configured).
    if (this.config.isSandbox) {
      await tx.sandboxMessage.create({ data: { channel: 'EMAIL', destination: input.email.toLowerCase(), body: `You have been invited to Pay with ARAF.\n\nAccept your invitation: ${link}` } });
    }
    await this.audit.record(actor, { action: 'user.invited', resourceType: 'USER_INVITATION', partnerId: input.partnerId, after: { email: input.email, roles: input.roleCodes } }, tx);
    return { invitation_link: this.config.isSandbox ? link : undefined };
  }

  async requestProduction(partnerId: string, comment: string, actor: Actor) {
    const p = await this.prisma.partner.findUniqueOrThrow({ where: { id: partnerId } });
    await this.prisma.$transaction(async (tx) => {
      await this.setStatus(tx, partnerId, 'PRODUCTION_PENDING', actor, comment);
      await this.approvals.create(tx, { type: 'PARTNER_PRODUCTION', resourceType: 'PARTNER', resourceId: partnerId, partnerId, payload: {}, summary: `Production activation for ${p.tradingName}`, comment }, actor);
    });
    return { status: 'PRODUCTION_PENDING', note: this.config.LIVE_OPERATIONS_ENABLED ? undefined : 'Production activation cannot be approved in this deployment: live operations are disabled pending production gates.' };
  }

  async suspend(partnerId: string, reason: string, actor: Actor) {
    if (!reason || reason.length < 3) fail('VALIDATION_FAILED', { fields: [{ path: 'reason', message: 'Reason required' }] });
    await this.prisma.$transaction(async (tx) => {
      await this.setStatus(tx, partnerId, 'SUSPENDED', actor, reason);
      await tx.partnerApiCredential.updateMany({ where: { partnerId, status: 'ACTIVE' }, data: { status: 'SUSPENDED' } });
    });
    return { status: 'SUSPENDED' };
  }

  async requestReactivation(partnerId: string, comment: string, actor: Actor) {
    const last = await this.prisma.partnerStatusHistory.findFirst({ where: { partnerId, toStatus: 'SUSPENDED' }, orderBy: { createdAt: 'desc' } });
    const target: PartnerStatus = last?.fromStatus === 'PRODUCTION_ACTIVE' ? 'PRODUCTION_ACTIVE' : 'SANDBOX_ACTIVE';
    const p = await this.prisma.partner.findUniqueOrThrow({ where: { id: partnerId } });
    if (p.status !== 'SUSPENDED') throw new AppError('INVALID_STATE');
    await this.prisma.$transaction((tx) =>
      this.approvals.create(tx, { type: 'PARTNER_REACTIVATION', resourceType: 'PARTNER', resourceId: partnerId, partnerId, payload: { target }, summary: `Reactivate ${p.tradingName} (${target})`, comment }, actor),
    );
    return { requested: true };
  }

  // ---- Vendors & settlement ---------------------------------------------------------

  async addVendor(partnerId: string, body: unknown, actor: Actor) {
    const input = vendorInputSchema.parse(body);
    const v = await this.prisma.vendor.create({
      data: { partnerId, environment: this.config.PLATFORM_ENVIRONMENT, vendorReference: input.vendor_reference, name: input.name, registrationNumber: input.registration_number, categories: input.categories.map((c) => c.toLowerCase()) },
    });
    await this.audit.record(actor, { action: 'vendor.created', resourceType: 'VENDOR', resourceId: v.id, partnerId, after: input });
    return { id: v.id };
  }

  async addSettlementAccount(partnerId: string, vendorId: string, body: unknown, actor: Actor) {
    const input = settlementAccountSchema.parse(body);
    const vendor = await this.prisma.vendor.findFirst({ where: { id: vendorId, partnerId } });
    if (!vendor) throw new AppError('NOT_FOUND');
    const enquiry = await this.providers.call(this.config.PLATFORM_ENVIRONMENT, 'ALTBANK', 'name_enquiry', { correlationId: actor.correlationId ?? 'x' }, () =>
      this.providers.for(this.config.PLATFORM_ENVIRONMENT).bankAccounts.nameEnquiry(input.bank_code, input.account_number, { correlationId: actor.correlationId ?? 'x' }),
    );
    const verified = !!enquiry;
    const acct = await this.prisma.$transaction(async (tx) => {
      const a = await tx.vendorSettlementAccount.create({
        data: {
          vendorId,
          bankCode: input.bank_code,
          bankName: input.bank_name,
          accountNumberEncrypted: this.crypto.encrypt(input.account_number, `settlement:${vendorId}`),
          accountNumberMasked: maskAccountNumber(input.account_number),
          accountName: input.account_name,
          verificationStatus: verified ? 'VERIFIED' : 'MISMATCH',
          verifiedName: enquiry?.accountName ?? null,
          verifiedAt: verified ? new Date() : null,
        },
      });
      await this.audit.record(actor, { action: 'vendor.settlement_account_added', resourceType: 'VENDOR_SETTLEMENT_ACCOUNT', resourceId: a.id, partnerId, after: { bank: input.bank_name, account: a.accountNumberMasked, verified } }, tx);
      if (verified) {
        await this.approvals.create(tx, { type: 'VENDOR_ACCOUNT', resourceType: 'VENDOR_SETTLEMENT_ACCOUNT', resourceId: a.id, partnerId, payload: { vendorId }, summary: `Settlement account ${a.accountNumberMasked} (${input.bank_name}) for ${vendor.name}` }, actor);
      }
      return a;
    });
    return { id: acct.id, verification_status: acct.verificationStatus, verified_name: acct.verifiedName };
  }

  async activePolicyRules() {
    const v = await this.prisma.creditPolicyVersion.findFirst({ where: { status: 'ACTIVE' }, orderBy: { version: 'desc' } });
    if (!v) throw new AppError('INTERNAL_ERROR');
    const { parsePolicyRules } = await import('@araf/business-rules');
    return parsePolicyRules(v.rules);
  }

  // ---- Credentials (partner portal) ----------------------------------------------------

  async createCredential(partnerId: string, body: unknown, actor: Actor) {
    const input = credentialSchema.parse(body);
    const env = this.config.PLATFORM_ENVIRONMENT;
    const partner = await this.prisma.partner.findUniqueOrThrow({ where: { id: partnerId } });
    if (env === 'PRODUCTION' && (partner.status !== 'PRODUCTION_ACTIVE' || !this.config.LIVE_OPERATIONS_ENABLED)) throw new AppError('PRODUCTION_LOCKED');
    if (env === 'SANDBOX' && !['SANDBOX_ACTIVE', 'PRODUCTION_PENDING', 'PRODUCTION_ACTIVE'].includes(partner.status)) throw new AppError('PARTNER_NOT_ACTIVE');
    const key = generateApiKey(env, this.config.API_KEY_PEPPER);
    const cred = await this.prisma.$transaction(async (tx) => {
      const c = await tx.partnerApiCredential.create({
        data: {
          partnerId,
          environment: env,
          name: input.name,
          lookupPrefix: key.lookupPrefix,
          keyHash: key.hash,
          last4: key.last4,
          scopes: input.scopes,
          ipAllowlist: input.ip_allowlist,
          expiresAt: input.expires_in_days ? new Date(Date.now() + input.expires_in_days * 86_400_000) : null,
          createdById: actor.id,
        },
      });
      await this.audit.record(actor, { action: 'credential.created', resourceType: 'API_CREDENTIAL', resourceId: c.id, partnerId, after: { name: input.name, scopes: input.scopes, environment: env, prefix: key.lookupPrefix } }, tx);
      return c;
    });
    // The secret is returned exactly once and never stored in recoverable form.
    return { id: cred.id, secret: key.secret, prefix: key.lookupPrefix, environment: env, scopes: cred.scopes, warning: 'Store this secret securely. It will not be shown again.' };
  }

  async listCredentials(partnerId: string) {
    const rows = await this.prisma.partnerApiCredential.findMany({ where: { partnerId }, orderBy: { createdAt: 'desc' } });
    return rows.map((c) => ({ id: c.id, name: c.name, environment: c.environment, prefix: c.lookupPrefix, last4: c.last4, scopes: c.scopes, ip_allowlist: c.ipAllowlist, status: c.status, last_used_at: c.lastUsedAt, expires_at: c.expiresAt, created_at: c.createdAt, revoked_at: c.revokedAt }));
  }

  async revokeCredential(partnerId: string, id: string, actor: Actor) {
    const c = await this.prisma.partnerApiCredential.findFirst({ where: { id, partnerId } });
    if (!c) throw new AppError('NOT_FOUND');
    await this.prisma.partnerApiCredential.update({ where: { id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedById: actor.id } });
    await this.audit.record(actor, { action: 'credential.revoked', resourceType: 'API_CREDENTIAL', resourceId: id, partnerId });
    return { ok: true };
  }

  /** Rotation = issue a new key with the same scopes; the old key stays valid for 24h (overlap) then expires. */
  async rotateCredential(partnerId: string, id: string, actor: Actor) {
    const c = await this.prisma.partnerApiCredential.findFirst({ where: { id, partnerId, status: 'ACTIVE' } });
    if (!c) throw new AppError('NOT_FOUND');
    const created = await this.createCredential(partnerId, { name: `${c.name} (rotated)`, scopes: c.scopes, ip_allowlist: c.ipAllowlist }, actor);
    await this.prisma.partnerApiCredential.update({ where: { id }, data: { expiresAt: new Date(Date.now() + 24 * 3600_000) } });
    await this.audit.record(actor, { action: 'credential.rotated', resourceType: 'API_CREDENTIAL', resourceId: id, partnerId, after: { replacement: created.id } });
    return created;
  }

  // ---- Webhook endpoints (partner portal) --------------------------------------------

  async createWebhookEndpoint(partnerId: string, body: unknown, actor: Actor) {
    const input = webhookEndpointSchema.parse(body);
    try {
      validateUrlSyntax(input.url, this.webhooks.urlPolicy());
    } catch (e) {
      if (e instanceof UnsafeUrlError) throw new AppError('WEBHOOK_URL_UNSAFE', { reason: e.code });
      throw e;
    }
    const secret = generateWebhookSecret();
    const ep = await this.prisma.$transaction(async (tx) => {
      const id = crypto.randomUUID();
      const e = await tx.webhookEndpoint.create({
        data: { id, partnerId, environment: this.config.PLATFORM_ENVIRONMENT, url: input.url, description: input.description, events: input.events, secretEncrypted: this.crypto.encrypt(secret, `whsec:${id}`), secretLast4: secret.slice(-4) },
      });
      await this.audit.record(actor, { action: 'webhook.endpoint_created', resourceType: 'WEBHOOK_ENDPOINT', resourceId: e.id, partnerId, after: { url: input.url, events: input.events } }, tx);
      return e;
    });
    return { id: ep.id, url: ep.url, signing_secret: secret, events: ep.events, status: ep.status };
  }

  async listWebhookEndpoints(partnerId: string) {
    const rows = await this.prisma.webhookEndpoint.findMany({ where: { partnerId, environment: this.config.PLATFORM_ENVIRONMENT }, orderBy: { createdAt: 'desc' } });
    return rows.map((e) => ({ id: e.id, url: e.url, description: e.description, events: e.events, status: e.status, secret_last4: e.secretLast4, consecutive_failures: e.consecutiveFailures, created_at: e.createdAt, rotation_in_progress: !!(e.previousSecretExpiresAt && e.previousSecretExpiresAt > new Date()) }));
  }

  async updateWebhookEndpoint(partnerId: string, id: string, body: unknown, actor: Actor) {
    const input = z.object({ status: z.enum(['ACTIVE', 'DISABLED']).optional(), events: webhookEndpointSchema.shape.events.optional() }).strict().parse(body);
    const e = await this.prisma.webhookEndpoint.findFirst({ where: { id, partnerId } });
    if (!e) throw new AppError('NOT_FOUND');
    await this.prisma.webhookEndpoint.update({ where: { id }, data: { status: input.status, events: input.events, consecutiveFailures: input.status === 'ACTIVE' ? 0 : undefined, suspendedAt: input.status === 'ACTIVE' ? null : undefined } });
    await this.audit.record(actor, { action: 'webhook.endpoint_updated', resourceType: 'WEBHOOK_ENDPOINT', resourceId: id, partnerId, before: { status: e.status, events: e.events }, after: input });
    return { ok: true };
  }

  async revealWebhookSecret(partnerId: string, id: string, actor: Actor) {
    const e = await this.prisma.webhookEndpoint.findFirst({ where: { id, partnerId } });
    if (!e) throw new AppError('NOT_FOUND');
    await this.audit.record(actor, { action: 'webhook.secret_revealed', resourceType: 'WEBHOOK_ENDPOINT', resourceId: id, partnerId });
    return { signing_secret: this.crypto.decrypt(e.secretEncrypted, `whsec:${e.id}`) };
  }

  /** Rotate: new secret signs immediately; the previous secret is ALSO signed for 24 hours. */
  async rotateWebhookSecret(partnerId: string, id: string, actor: Actor) {
    const e = await this.prisma.webhookEndpoint.findFirst({ where: { id, partnerId } });
    if (!e) throw new AppError('NOT_FOUND');
    const secret = generateWebhookSecret();
    await this.prisma.webhookEndpoint.update({
      where: { id },
      data: { previousSecretEncrypted: e.secretEncrypted, previousSecretExpiresAt: new Date(Date.now() + 24 * 3600_000), secretEncrypted: this.crypto.encrypt(secret, `whsec:${id}`), secretLast4: secret.slice(-4) },
    });
    await this.audit.record(actor, { action: 'webhook.secret_rotated', resourceType: 'WEBHOOK_ENDPOINT', resourceId: id, partnerId });
    return { signing_secret: secret, previous_secret_valid_until: new Date(Date.now() + 24 * 3600_000) };
  }

  // ---- Partner-side settings (Super Admin = maker, Partner Approving Officer = checker) -------

  /** Propose partner portal settings. Nothing changes for the partner until a checker approves. */
  async proposePortalSettings(partnerId: string, body: unknown, actor: Actor) {
    const settings = partnerPortalSettingsSchema.parse(body);
    const partner = await this.prisma.partner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new AppError('NOT_FOUND');
    if (['REJECTED', 'TERMINATED'].includes(partner.status)) throw new AppError('INVALID_STATE');
    const current = effectivePortalSettings(partner.portalSettings);
    const off = Object.entries(settings.modules).filter(([, on]) => !on).map(([k]) => PARTNER_PORTAL_MODULES[k as PartnerPortalModule].label);
    const summary = `Partner portal settings for ${partner.tradingName}: ${off.length ? `sections off — ${off.join(', ')}` : 'all sections on'}; button ${settings.checkout_button.theme}${settings.checkout_button.show_amount ? ' with amount' : ''}; up to ${settings.max_users} users`;
    const approval = await this.prisma.$transaction(async (tx) => {
      const a = await this.approvals.create(tx, { type: 'PARTNER_PORTAL', resourceType: 'PARTNER', resourceId: partnerId, partnerId, payload: { settings, previous: current }, summary }, actor);
      await this.audit.record(actor, { action: 'partner.portal_settings_proposed', resourceType: 'PARTNER', resourceId: partnerId, partnerId, before: current, after: settings }, tx);
      return a;
    });
    return { approval_reference: approval.reference, status: 'PENDING_APPROVAL', settings };
  }

  async portalSettingsView(partnerId: string) {
    const partner = await this.prisma.partner.findUniqueOrThrow({ where: { id: partnerId }, select: { portalSettings: true } });
    const pending = await this.prisma.approvalRequest.findFirst({ where: { type: 'PARTNER_PORTAL', resourceId: partnerId, status: 'PENDING' } });
    const last = await this.prisma.approvalRequest.findFirst({ where: { type: 'PARTNER_PORTAL', resourceId: partnerId, status: 'APPROVED' }, orderBy: { decidedAt: 'desc' } });
    return {
      active: effectivePortalSettings(partner.portalSettings),
      configured: partner.portalSettings !== null,
      last_approved: last ? { reference: last.reference, decided_at: last.decidedAt } : null,
      pending: pending ? { reference: pending.reference, settings: (pending.payload as { settings: unknown }).settings, created_at: pending.createdAt } : null,
      modules: Object.entries(PARTNER_PORTAL_MODULES).map(([key, m]) => ({ key, label: m.label, description: m.description })),
    };
  }

  // ---- Team (partner portal) -----------------------------------------------------------

  async inviteTeamMember(partnerId: string, body: unknown, actor: Actor) {
    const input = z
      .object({ email: z.string().email(), full_name: text(120), role: z.enum(PARTNER_ROLES.map((r) => r.code) as [string, ...string[]]) })
      .strict()
      .parse(body);
    const exists = await this.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (exists) throw new AppError('CONFLICT', undefined, 'A user with this email already exists.');
    // The Bank's Super Admin sets how many portal users each partner may have.
    const partner = await this.prisma.partner.findUniqueOrThrow({ where: { id: partnerId }, select: { portalSettings: true } });
    const limit = effectivePortalSettings(partner.portalSettings).max_users;
    const seats = (await this.prisma.user.count({ where: { partnerId, status: { not: 'DISABLED' } } })) + (await this.prisma.userInvitation.count({ where: { partnerId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }));
    if (seats >= limit) throw new AppError('PARTNER_USER_LIMIT_REACHED', { limit });
    return this.prisma.$transaction((tx) => this.createInvitation(tx, { email: input.email, fullName: input.full_name, type: 'PARTNER', partnerId, roleCodes: [input.role] }, actor));
  }

  async listTeam(partnerId: string) {
    const users = await this.prisma.user.findMany({ where: { partnerId }, include: { roles: { include: { role: true } } }, orderBy: { createdAt: 'asc' } });
    const invites = await this.prisma.userInvitation.findMany({ where: { partnerId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
    return {
      users: users.map((u) => ({ id: u.id, email: u.email, full_name: u.fullName, status: u.status, roles: u.roles.map((r) => r.role.code), last_login_at: u.lastLoginAt })),
      pending_invitations: invites.map((i) => ({ id: i.id, email: i.email, full_name: i.fullName, roles: i.roleCodes, expires_at: i.expiresAt })),
      available_roles: PARTNER_ROLES.map((r) => ({ code: r.code, name: r.name, description: r.description })),
    };
  }

  async setTeamMemberStatus(partnerId: string, userId: string, status: 'ACTIVE' | 'SUSPENDED', actor: Actor) {
    if (userId === actor.id) throw new AppError('FORBIDDEN', undefined, 'You cannot change your own access.');
    const u = await this.prisma.user.findFirst({ where: { id: userId, partnerId } });
    if (!u) throw new AppError('NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status } });
      if (status === 'SUSPENDED') await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'USER_SUSPENDED' } });
      await this.audit.record(actor, { action: 'user.status_changed', resourceType: 'USER', resourceId: userId, partnerId, before: { status: u.status }, after: { status } }, tx);
    });
    return { ok: true };
  }
}
