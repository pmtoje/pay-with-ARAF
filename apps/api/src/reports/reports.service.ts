import { Inject, Injectable } from '@nestjs/common';
import { FUNNEL_STAGES, deriveMerchantStatus, hasReached, type ApplicationState } from '@araf/business-rules';
import { toCsv } from '@araf/security';
import type { Environment, Prisma } from '@araf/database';
import { CONFIG, type AppConfig } from '../config';
import { PrismaService } from '../common/prisma.service';

export interface DateRange {
  from: Date;
  to: Date;
}

export function parseRange(q: { range?: string; from?: string; to?: string }): DateRange {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  switch (q.range) {
    case 'today':
      return { from: startOfDay(now), to: now };
    case 'yesterday': {
      const y = new Date(startOfDay(now).getTime() - 86_400_000);
      return { from: y, to: startOfDay(now) };
    }
    case '7d':
      return { from: new Date(now.getTime() - 7 * 86_400_000), to: now };
    case 'month':
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: now };
    case 'custom':
      if (q.from && q.to) return { from: new Date(q.from), to: new Date(new Date(q.to).getTime() + 86_399_999) };
      return { from: new Date(now.getTime() - 30 * 86_400_000), to: now };
    case 'all':
      return { from: new Date(0), to: now };
    default:
      return { from: new Date(now.getTime() - 30 * 86_400_000), to: now };
  }
}

const sum = (xs: Array<bigint | null | undefined>) => xs.reduce<bigint>((s, x) => s + (x ?? 0n), 0n);

/** Every figure is computed from database records. Nothing is invented. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private async apps(where: Prisma.FinancingApplicationWhereInput) {
    return this.prisma.financingApplication.findMany({
      where: { environment: this.config.PLATFORM_ENVIRONMENT, ...where },
      select: { id: true, reference: true, partnerId: true, status: true, purchaseAmountKobo: true, eligibleAmountKobo: true, financingAmountKobo: true, createdAt: true, completedAt: true, incomeProfile: true },
    });
  }

  async partnerOverview(partnerId: string, range: DateRange) {
    const apps = await this.apps({ partnerId, createdAt: { gte: range.from, lte: range.to } });
    const st = (s: string) => apps.filter((a) => deriveMerchantStatus(a.status as ApplicationState) === s).length;
    const payments = await this.prisma.vendorPaymentInstruction.findMany({ where: { partnerId, environment: this.config.PLATFORM_ENVIRONMENT, createdAt: { gte: range.from, lte: range.to } } });
    const reached = (s: ApplicationState) => apps.filter((a) => hasReached(a.status as ApplicationState, s)).length;
    const completedDurations = await this.durations(apps.filter((a) => a.completedAt).map((a) => a.id));
    return {
      range,
      total_applications: apps.length,
      total_requested_value: Number(sum(apps.map((a) => a.purchaseAmountKobo))),
      eligible_applications: reached('ELIGIBLE'),
      submitted_to_araf: reached('ARAF_SUBMITTED'),
      approved: reached('FINANCING_APPROVED'),
      declined: st('DECLINED'),
      pending_customer_action: st('CUSTOMER_ACTION_REQUIRED'),
      vendor_payments_pending: payments.filter((p) => ['PENDING_APPROVAL', 'INITIATED', 'PROCESSING', 'UNKNOWN', 'RECONCILIATION_REQUIRED'].includes(p.status)).length,
      vendor_payments_confirmed: payments.filter((p) => p.status === 'CONFIRMED').length,
      confirmed_payment_value: Number(sum(payments.filter((p) => p.status === 'CONFIRMED').map((p) => p.amountKobo))),
      ready_for_release: st('READY_FOR_RELEASE'),
      dispatched: st('DISPATCHED'),
      delivered: st('DELIVERED') + st('COMPLETED'),
      conversion_rate: apps.length ? reached('FINANCING_APPROVED') / apps.length : null,
      average_processing_hours: completedDurations,
      daily: this.daily(apps, range),
      status_breakdown: Object.entries(apps.reduce<Record<string, number>>((m, a) => ({ ...m, [deriveMerchantStatus(a.status as ApplicationState)]: (m[deriveMerchantStatus(a.status as ApplicationState)] ?? 0) + 1 }), {})).map(([status, count]) => ({ status, count })),
    };
  }

  private daily(apps: Array<{ createdAt: Date; purchaseAmountKobo: bigint }>, range: DateRange) {
    const days = Math.min(62, Math.max(1, Math.ceil((range.to.getTime() - Math.max(range.from.getTime(), Date.now() - 62 * 86_400_000)) / 86_400_000)));
    const out: Array<{ date: string; applications: number; value: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(range.to.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      const day = apps.filter((a) => a.createdAt.toISOString().slice(0, 10) === d);
      out.push({ date: d, applications: day.length, value: Number(sum(day.map((a) => a.purchaseAmountKobo))) });
    }
    return out;
  }

  private async durations(appIds: string[]): Promise<number | null> {
    if (!appIds.length) return null;
    const firsts = await this.prisma.financingApplication.findMany({ where: { id: { in: appIds } }, select: { createdAt: true, completedAt: true } });
    const hours = firsts.filter((f) => f.completedAt).map((f) => (f.completedAt!.getTime() - f.createdAt.getTime()) / 3_600_000);
    return hours.length ? Math.round((hours.reduce((s, h) => s + h, 0) / hours.length) * 10) / 10 : null;
  }

  async executiveOverview(range: DateRange) {
    const env = this.config.PLATFORM_ENVIRONMENT;
    const [partners, apps, payments, offers, bookings, pendingReviews, openExceptions] = await Promise.all([
      this.prisma.partner.findMany({ select: { id: true, tradingName: true, status: true } }),
      this.apps({ createdAt: { gte: range.from, lte: range.to } }),
      this.prisma.vendorPaymentInstruction.findMany({ where: { environment: env, createdAt: { gte: range.from, lte: range.to } } }),
      this.prisma.financingOffer.findMany({ where: { status: 'ACCEPTED', createdAt: { gte: range.from, lte: range.to } } }),
      this.prisma.bookingRecord.findMany({ where: { status: 'BOOKED', createdAt: { gte: range.from, lte: range.to } } }),
      this.prisma.enhancedReview.count({ where: { status: { in: ['PENDING', 'DECISION_PENDING_APPROVAL', 'ESCALATED'] } } }),
      this.prisma.operationalException.count({ where: { environment: env, status: { in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] } } }),
    ]);
    const reached = (s: ApplicationState) => apps.filter((a) => hasReached(a.status as ApplicationState, s));
    const decided = apps.filter((a) => a.status === 'DECLINED' || hasReached(a.status as ApplicationState, 'FINANCING_APPROVED')).length;
    const approved = reached('FINANCING_APPROVED');
    const stageCounts = apps.reduce<Record<string, number>>((m, a) => ({ ...m, [a.status]: (m[a.status] ?? 0) + 1 }), {});
    const byPartner = partners.map((p) => {
      const pa = apps.filter((a) => a.partnerId === p.id);
      return { partner: p.tradingName, status: p.status, applications: pa.length, requested: Number(sum(pa.map((a) => a.purchaseAmountKobo))), approved: pa.filter((a) => hasReached(a.status as ApplicationState, 'FINANCING_APPROVED')).length };
    });
    const items = await this.prisma.orderItem.findMany({ where: { orderId: { in: (await this.prisma.financingApplication.findMany({ where: { id: { in: apps.map((a) => a.id) } }, select: { orderId: true } })).map((o) => o.orderId) } } });
    const categories = Object.entries(items.reduce<Record<string, bigint>>((m, i) => ({ ...m, [i.category]: (m[i.category] ?? 0n) + i.lineAmountKobo }), {})).map(([category, value]) => ({ category, value: Number(value) }));
    const integration = await this.integrationHealth(range);
    return {
      range,
      environment: env,
      partners_onboarded: partners.filter((p) => !['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'REJECTED'].includes(p.status)).length,
      partners_active: partners.filter((p) => ['SANDBOX_ACTIVE', 'PRODUCTION_ACTIVE', 'PRODUCTION_PENDING'].includes(p.status)).length,
      total_applications: apps.length,
      requested_value: Number(sum(apps.map((a) => a.purchaseAmountKobo))),
      eligible_value: Number(sum(reached('ELIGIBLE').map((a) => a.eligibleAmountKobo))),
      approved_value: Number(sum(offers.filter((o) => approved.some((a) => a.id === o.applicationId)).map((o) => o.financingAmountKobo))),
      booked_value: Number(sum(bookings.map((b) => b.financingAmountKobo))),
      confirmed_vendor_payments: Number(sum(payments.filter((p) => p.status === 'CONFIRMED').map((p) => p.amountKobo))),
      completed_deliveries: apps.filter((a) => ['GOODS_DELIVERED', 'COMPLETED'].includes(a.status)).length,
      conversion_rate: apps.length ? approved.length / apps.length : null,
      approval_rate: decided ? approved.length / decided : null,
      decline_rate: decided ? apps.filter((a) => a.status === 'DECLINED').length / decided : null,
      average_turnaround_hours: await this.durations(apps.filter((a) => a.completedAt).map((a) => a.id)),
      pending_reviews: pendingReviews,
      open_exceptions: openExceptions,
      pending_by_stage: Object.entries(stageCounts).filter(([s]) => !['COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED'].includes(s)).map(([stage, count]) => ({ stage, count })),
      partner_performance: byPartner,
      category_performance: categories,
      integration_performance: integration,
      daily: this.daily(apps, range),
    };
  }

  async funnel(range: DateRange, partnerId?: string) {
    const apps = await this.apps({ createdAt: { gte: range.from, lte: range.to }, partnerId });
    // Declined/cancelled apps still "reached" every stage recorded in their history.
    const history = await this.prisma.stateTransition.findMany({ where: { applicationId: { in: apps.map((a) => a.id) }, machine: 'APPLICATION' }, select: { applicationId: true, toState: true } });
    const reachedSet = new Map<string, Set<string>>();
    for (const h of history) reachedSet.set(h.applicationId!, (reachedSet.get(h.applicationId!) ?? new Set()).add(h.toState));
    return FUNNEL_STAGES.map((s) => ({
      key: s.key,
      label: s.label,
      count: apps.filter((a) => {
        const set = reachedSet.get(a.id) ?? new Set<string>();
        if (s.key === 'credit') return set.has('ACCOUNT_VERIFICATION_PENDING');
        if (s.key === 'delivered') return set.has('GOODS_DELIVERED');
        return set.has(s.reachedAt);
      }).length,
    }));
  }

  async creditReport(range: DateRange) {
    const assessments = await this.prisma.creditAssessment.findMany({ where: { createdAt: { gte: range.from, lte: range.to }, status: 'COMPLETED' }, select: { score: true, band: true } });
    const afford = await this.prisma.affordabilityAssessment.findMany({ where: { createdAt: { gte: range.from, lte: range.to } }, select: { outcome: true, reasons: true } });
    const declines = await this.prisma.financingApplication.findMany({ where: { environment: this.config.PLATFORM_ENVIRONMENT, status: 'DECLINED', createdAt: { gte: range.from, lte: range.to } }, select: { declineReasonCode: true } });
    const reviews = await this.prisma.reviewDecision.findMany({ where: { createdAt: { gte: range.from, lte: range.to }, status: 'EFFECTIVE' }, select: { decision: true } });
    const reservations = await this.prisma.exposureReservation.findMany({ where: { status: { in: ['ACTIVE', 'CONSUMED'] } } });
    const buckets = [280, 330, 380, 430, 480, 530, 580, 620, 670, 720, 770].map((min, i, arr) => ({ min, max: (arr[i + 1] ?? 801) - 1 }));
    const count = <T>(xs: T[], key: (x: T) => string) => Object.entries(xs.reduce<Record<string, number>>((m, x) => ({ ...m, [key(x)]: (m[key(x)] ?? 0) + 1 }), {})).map(([k, v]) => ({ key: k, count: v }));
    return {
      score_distribution: buckets.map((b) => ({ range: `${b.min}–${b.max}`, count: assessments.filter((a) => a.score !== null && a.score >= b.min && a.score <= b.max).length })),
      bands: count(assessments, (a) => a.band ?? 'UNKNOWN'),
      affordability_outcomes: count(afford, (a) => a.outcome),
      decline_reasons: count(declines, (d) => d.declineReasonCode ?? 'UNSPECIFIED'),
      manual_review_outcomes: count(reviews, (r) => r.decision),
      exposure_reserved: Number(sum(reservations.map((r) => r.amountKobo))),
    };
  }

  async operations() {
    const env = this.config.PLATFORM_ENVIRONMENT;
    const apps = await this.apps({ status: { notIn: ['COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED'] } });
    const now = Date.now();
    const aging = apps.map((a) => ({ stage: a.status, hours: (now - a.createdAt.getTime()) / 3_600_000 }));
    const stages = [...new Set(aging.map((a) => a.stage))];
    const exceptions = await this.prisma.operationalException.groupBy({ by: ['category', 'responsibleTeam', 'status'], where: { environment: env }, _count: { _all: true } });
    const breaches = await this.prisma.enhancedReview.count({ where: { slaDueAt: { lt: new Date() }, status: { in: ['PENDING', 'DECISION_PENDING_APPROVAL', 'ESCALATED'] } } });
    const findings = await this.prisma.reconciliationFinding.count({ where: { status: 'OPEN' } });
    return {
      pending_applications: apps.length,
      aging_by_stage: stages.map((s) => {
        const xs = aging.filter((a) => a.stage === s);
        return { stage: s, count: xs.length, avg_hours: Math.round((xs.reduce((t, x) => t + x.hours, 0) / xs.length) * 10) / 10, over_24h: xs.filter((x) => x.hours > 24).length };
      }),
      sla_breaches: breaches,
      exceptions: exceptions.map((e) => ({ category: e.category, team: e.responsibleTeam, status: e.status, count: e._count._all })),
      open_reconciliation_findings: findings,
    };
  }

  /** Portfolio metrics require authoritative repayment data from core banking, which is not integrated. */
  portfolio() {
    return {
      available: false,
      reason: 'Repayment performance, outstanding balances and past-due data are held in the Bank’s core banking system, which is not yet integrated. These metrics are intentionally not estimated.',
      metrics: ['Outstanding financing', 'Repayment performance', 'Past-due obligations', 'Portfolio quality', 'Product concentration', 'Partner concentration'],
    };
  }

  async integrationHealth(range: DateRange) {
    const logs = await this.prisma.integrationLog.findMany({ where: { createdAt: { gte: range.from, lte: range.to } }, select: { provider: true, outcome: true, latencyMs: true, isSimulated: true } });
    const providers = [...new Set(logs.map((l) => l.provider))];
    return providers.map((p) => {
      const xs = logs.filter((l) => l.provider === p);
      const lat = xs.map((x) => x.latencyMs).sort((a, b) => a - b);
      return { provider: p, calls: xs.length, success_rate: xs.filter((x) => x.outcome === 'SUCCESS').length / xs.length, p50_ms: lat[Math.floor(lat.length / 2)] ?? 0, p95_ms: lat[Math.floor(lat.length * 0.95)] ?? 0, simulated: xs.every((x) => x.isSimulated) };
    });
  }

  async webhookHealth(range: DateRange, partnerId?: string) {
    const deliveries = await this.prisma.webhookDelivery.findMany({ where: { createdAt: { gte: range.from, lte: range.to }, event: partnerId ? { partnerId } : undefined }, select: { status: true } });
    const total = deliveries.length;
    return {
      total,
      succeeded: deliveries.filter((d) => d.status === 'SUCCEEDED').length,
      retrying: deliveries.filter((d) => d.status === 'RETRYING' || d.status === 'PENDING').length,
      dead_lettered: deliveries.filter((d) => d.status === 'DEAD_LETTERED').length,
      success_rate: total ? deliveries.filter((d) => d.status === 'SUCCEEDED').length / total : null,
    };
  }

  async exportApplicationsCsv(range: DateRange, partnerId?: string, merchantSafe = false): Promise<string> {
    const apps = await this.prisma.financingApplication.findMany({ where: { environment: this.config.PLATFORM_ENVIRONMENT, partnerId, createdAt: { gte: range.from, lte: range.to } }, orderBy: { createdAt: 'desc' }, take: 10_000 });
    const orders = new Map((await this.prisma.merchantOrder.findMany({ where: { id: { in: apps.map((a) => a.orderId) } } })).map((o) => [o.id, o]));
    const partners = new Map((await this.prisma.partner.findMany({ select: { id: true, tradingName: true } })).map((p) => [p.id, p.tradingName]));
    const headers = merchantSafe
      ? ['Application', 'Order', 'Status', 'Purchase amount (NGN)', 'Created']
      : ['Application', 'Partner', 'Order', 'State', 'Merchant status', 'Purchase amount (NGN)', 'Financing amount (NGN)', 'Created'];
    const rows = apps.map((a) =>
      merchantSafe
        ? [a.reference, orders.get(a.orderId)?.merchantOrderReference, deriveMerchantStatus(a.status as ApplicationState), Number(a.purchaseAmountKobo) / 100, a.createdAt.toISOString()]
        : [a.reference, partners.get(a.partnerId), orders.get(a.orderId)?.merchantOrderReference, a.status, deriveMerchantStatus(a.status as ApplicationState), Number(a.purchaseAmountKobo) / 100, a.financingAmountKobo ? Number(a.financingAmountKobo) / 100 : '', a.createdAt.toISOString()],
    );
    return toCsv(headers, rows);
  }

  environment(): Environment {
    return this.config.PLATFORM_ENVIRONMENT;
  }
}
