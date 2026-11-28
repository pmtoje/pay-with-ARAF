-- Backup repayment card (Paystack) and charges against it (maker-checker).
CREATE TABLE "repayment_cards" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "linkReference" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "authorizationEncrypted" TEXT,
    "signatureHash" TEXT,
    "last4" TEXT,
    "expMonth" TEXT,
    "expYear" TEXT,
    "cardType" TEXT,
    "bank" TEXT,
    "checkAmountKobo" BIGINT NOT NULL,
    "checkTransactionId" TEXT,
    "refundStatus" TEXT,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    CONSTRAINT "repayment_cards_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "repayment_cards_status_check" CHECK ("status" IN ('PENDING', 'ACTIVE', 'FAILED', 'REPLACED')),
    CONSTRAINT "repayment_cards_amount_check" CHECK ("checkAmountKobo" > 0)
);
CREATE UNIQUE INDEX "repayment_cards_linkReference_key" ON "repayment_cards"("linkReference");
CREATE INDEX "repayment_cards_applicationId_status_idx" ON "repayment_cards"("applicationId", "status");
CREATE INDEX "repayment_cards_signatureHash_idx" ON "repayment_cards"("signatureHash");
-- At most one active backup card per application.
CREATE UNIQUE INDEX "repayment_cards_one_active" ON "repayment_cards"("applicationId") WHERE "status" = 'ACTIVE';

CREATE TABLE "card_charges" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerTxnId" TEXT,
    "gatewayResponse" TEXT,
    "approvalId" TEXT,
    "requestedById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "card_charges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "card_charges_status_check" CHECK ("status" IN ('REQUESTED', 'SUCCESS', 'FAILED', 'UNKNOWN')),
    CONSTRAINT "card_charges_amount_check" CHECK ("amountKobo" > 0),
    CONSTRAINT "card_charges_card_fkey" FOREIGN KEY ("cardId") REFERENCES "repayment_cards"("id")
);
CREATE UNIQUE INDEX "card_charges_reference_key" ON "card_charges"("reference");
CREATE UNIQUE INDEX "card_charges_approvalId_key" ON "card_charges"("approvalId");
CREATE INDEX "card_charges_applicationId_idx" ON "card_charges"("applicationId");
