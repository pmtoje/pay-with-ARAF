-- Financial integrity and tamper-resistance controls that Prisma cannot express.

-- 1. Append-only audit trail: block UPDATE and DELETE on audit logs and state history.
CREATE OR REPLACE FUNCTION araf_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only (% blocked)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION araf_forbid_mutation();
CREATE TRIGGER state_history_append_only BEFORE UPDATE OR DELETE ON "application_state_history"
  FOR EACH ROW EXECUTE FUNCTION araf_forbid_mutation();
CREATE TRIGGER payment_events_append_only BEFORE UPDATE OR DELETE ON "vendor_payment_events"
  FOR EACH ROW EXECUTE FUNCTION araf_forbid_mutation();
CREATE TRIGGER araf_status_events_no_delete BEFORE DELETE ON "araf_status_events"
  FOR EACH ROW EXECUTE FUNCTION araf_forbid_mutation();

-- 2. Duplicate vendor payment prevention: at most ONE live (not FAILED / REVERSED)
--    payment instruction per application, enforced by the database itself.
CREATE UNIQUE INDEX vendor_payment_one_live_per_application
  ON "vendor_payment_instructions" ("applicationId")
  WHERE status NOT IN ('FAILED', 'REVERSED');

-- 3. At most one ACTIVE / PRESENTED offer per application and one active policy version per policy.
CREATE UNIQUE INDEX financing_offer_one_accepted_per_application
  ON "financing_offers" ("applicationId") WHERE status = 'ACCEPTED';
CREATE UNIQUE INDEX credit_policy_one_active_version
  ON "credit_policy_versions" ("policyId") WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX partner_config_one_active
  ON "partner_configurations" ("partnerId") WHERE status = 'ACTIVE';

-- 4. Monetary sanity constraints (integer kobo, never negative).
ALTER TABLE "merchant_orders" ADD CONSTRAINT merchant_orders_amount_positive CHECK ("amountKobo" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT order_items_amounts_valid CHECK ("quantity" > 0 AND "unitAmountKobo" > 0 AND "lineAmountKobo" = "unitAmountKobo" * "quantity");
ALTER TABLE "checkout_sessions" ADD CONSTRAINT checkout_amount_positive CHECK ("amountKobo" > 0);
ALTER TABLE "financing_applications" ADD CONSTRAINT application_amounts_valid CHECK (
  "purchaseAmountKobo" > 0 AND "contributionAmountKobo" >= 0
  AND ("financingAmountKobo" IS NULL OR ("financingAmountKobo" > 0 AND "financingAmountKobo" + "contributionAmountKobo" = "purchaseAmountKobo"))
);
ALTER TABLE "financing_offers" ADD CONSTRAINT offer_amounts_valid CHECK (
  "financingAmountKobo" > 0 AND "contributionKobo" >= 0
  AND "financingAmountKobo" + "contributionKobo" = "purchaseAmountKobo"
  AND "deferredSalePriceKobo" = "financingAmountKobo" + "profitKobo"
  AND "tenorMonths" > 0
);
ALTER TABLE "vendor_payment_instructions" ADD CONSTRAINT payment_amount_positive CHECK ("amountKobo" > 0);
ALTER TABLE "release_authorizations" ADD CONSTRAINT release_amount_positive CHECK ("authorizedAmountKobo" > 0);
ALTER TABLE "exposure_reservations" ADD CONSTRAINT reservation_amount_positive CHECK ("amountKobo" > 0);
ALTER TABLE "partner_configurations" ADD CONSTRAINT partner_limits_valid CHECK ("minTransactionKobo" > 0 AND "maxTransactionKobo" >= "minTransactionKobo");

-- 5. Maker-checker: the checker can never be the maker.
ALTER TABLE "approval_requests" ADD CONSTRAINT approval_checker_not_maker CHECK ("checkerId" IS NULL OR "checkerId" <> "makerId");
ALTER TABLE "credit_policy_versions" ADD CONSTRAINT policy_checker_not_maker CHECK ("checkerId" IS NULL OR "checkerId" <> "makerId");
ALTER TABLE "vendor_payment_instructions" ADD CONSTRAINT payment_approver_not_initiator CHECK ("approvedById" IS NULL OR "approvedById" <> "initiatedById");
