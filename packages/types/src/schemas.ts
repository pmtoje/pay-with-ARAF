import { z } from 'zod';

/** Public partner API request schemas (snake_case on the wire). Monetary values are integer kobo. */

const kobo = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const reference = z.string().min(1).max(64).regex(/^[A-Za-z0-9._:\-\/]+$/, 'Use letters, digits and . _ : - / only');

export const checkoutItemSchema = z.object({
  sku: reference,
  name: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(1000),
  unit_amount: kobo,
  category: z.string().min(1).max(64),
  vendor_reference: reference,
});

export const createCheckoutSessionSchema = z
  .object({
    merchant_order_reference: reference,
    currency: z.literal('NGN'),
    amount: kobo,
    items: z.array(checkoutItemSchema).min(1).max(50),
    /**
     * Details the merchant already collected. Pay with ARAF pre-fills them and only asks the shopper
     * for what is missing. They are encrypted at rest, never returned to the merchant, and identity
     * is still proven with a one-time code sent to the phone linked to the BVN.
     */
    customer: z
      .object({
        email: z.string().email().max(254).optional(),
        phone: z.string().regex(/^\+?\d{10,15}$/).optional(),
        first_name: z.string().trim().min(1).max(80).optional(),
        last_name: z.string().trim().min(1).max(80).optional(),
        date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        bvn: z.string().regex(/^\d{11}$/).optional(),
        /** As on the BVN record; used for the credit check when the BVN service does not return it. */
        gender: z.enum(['male', 'female']).optional(),
        /** How the shopper earns. Skips the "How do you earn?" step. */
        income_type: z.enum(['SALARY', 'BUSINESS']).optional(),
        employer_name: z.string().trim().min(1).max(120).optional(),
        business_name: z.string().trim().min(1).max(120).optional(),
        nature_of_business: z.string().trim().min(1).max(200).optional(),
        address: z
          .object({ line1: z.string().trim().min(1).max(200), city: z.string().trim().min(1).max(80), state: z.string().trim().min(1).max(80) })
          .strict()
          .optional(),
      })
      .strict()
      .default({}),
    /**
     * Equity (down payment) the shopper already agreed with the merchant, in kobo. Used as the shopper's equity
     * choice when it is within the allowed range; otherwise the shopper chooses. Paid to the merchant.
     */
    customer_equity_amount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    return_url: z.string().url().max(2048),
    cancel_url: z.string().url().max(2048),
    revises_session_id: z.string().max(80).optional(),
    metadata: z.record(z.string().max(64), z.string().max(256)).optional(),
  })
  .strict();

export type CreateCheckoutSessionRequest = z.infer<typeof createCheckoutSessionSchema>;

export const fulfilSchema = z
  .object({
    status: z.enum(['PREPARED', 'DISPATCHED', 'COLLECTED']),
    tracking_reference: z.string().max(120).optional(),
    carrier: z.string().max(120).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

export const deliverSchema = z
  .object({
    delivered_at: z.string().datetime().optional(),
    note: z.string().max(500).optional(),
    exception: z.boolean().optional(),
  })
  .strict();

export const cancelOrderSchema = z.object({ reason: z.string().min(3).max(500) }).strict();

export const returnOrderSchema = z
  .object({
    type: z.enum(['FULL_RETURN', 'PARTIAL_RETURN', 'DAMAGED', 'INCORRECT_PRODUCT', 'NON_DELIVERY']),
    reason: z.string().min(3).max(500),
    items: z.array(z.object({ sku: reference, quantity: z.number().int().min(1) })).optional(),
  })
  .strict();

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  starting_after: z.string().max(80).optional(),
});
