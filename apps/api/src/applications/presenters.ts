import { deriveCustomerStatus, deriveMerchantStatus, type ApplicationState } from '@araf/business-rules';
import type { FinancingApplication, ReleaseAuthorization, VendorPaymentInstruction } from '@araf/database';

export const n = (v: bigint | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * Merchant-facing application view. NEVER includes BVN, score, bureau data, statements,
 * salary, affordability calculations, decline reasons or internal notes.
 */
export function presentMerchantApplication(
  app: FinancingApplication,
  extra: {
    merchantOrderReference: string;
    checkoutSessionId: string;
    payment?: VendorPaymentInstruction | null;
    release?: ReleaseAuthorization | null;
    timeline?: Array<{ status: string; at: Date }>;
    fulfilment?: Array<{ status: string; at: Date; tracking_reference: string | null }>;
  },
) {
  const status = deriveMerchantStatus(app.status as ApplicationState);
  return {
    object: 'application',
    reference: app.reference,
    status,
    merchant_order_reference: extra.merchantOrderReference,
    checkout_session_id: extra.checkoutSessionId,
    currency: 'NGN',
    purchase_amount: n(app.purchaseAmountKobo),
    // Customer contribution is operationally relevant for settlement; it is not a credit detail.
    customer_contribution: n(app.contributionAmountKobo) ?? 0,
    vendor_payment: extra.payment
      ? {
          reference: extra.payment.reference,
          status: extra.payment.status,
          amount: n(extra.payment.amountKobo),
          confirmed_at: extra.payment.confirmedAt,
          simulated: extra.payment.isSimulated,
        }
      : null,
    release: extra.release
      ? { reference: extra.release.reference, status: extra.release.status, authorized: extra.release.status === 'AUTHORIZED' || extra.release.status === 'CONSUMED', authorized_at: extra.release.authorizedAt }
      : { authorized: false },
    timeline: extra.timeline ?? [],
    fulfilment: extra.fulfilment ?? [],
    livemode: app.environment === 'PRODUCTION',
    created_at: app.createdAt,
    updated_at: app.updatedAt,
  };
}

/** Collapse internal state history into merchant statuses (hiding e.g. enhanced-review states). */
export function merchantTimeline(history: Array<{ toState: string; createdAt: Date }>) {
  const out: Array<{ status: string; at: Date }> = [];
  for (const h of history) {
    const s = deriveMerchantStatus(h.toState as ApplicationState);
    if (out[out.length - 1]?.status !== s) out.push({ status: s, at: h.createdAt });
  }
  return out;
}

export function customerStatus(state: string) {
  return deriveCustomerStatus(state as ApplicationState);
}
