-- AlterTable
ALTER TABLE "financing_applications" ADD COLUMN     "merchantFeeBps" INTEGER NOT NULL DEFAULT 200;

-- AlterTable
ALTER TABLE "partner_configurations" ADD COLUMN     "merchantFeeBps" INTEGER NOT NULL DEFAULT 200;

-- CreateTable
CREATE TABLE "merchant_fees" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "baseAmountKobo" BIGINT NOT NULL,
    "feeBps" INTEGER NOT NULL,
    "feeKobo" BIGINT NOT NULL,
    "reason" TEXT,
    "invoiceId" TEXT,
    "accruedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_invoices" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "period" TEXT NOT NULL,
    "feeCount" INTEGER NOT NULL,
    "totalKobo" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "issuedById" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "paymentReference" TEXT,
    "recordedPaidById" TEXT,

    CONSTRAINT "merchant_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_fees_partnerId_environment_invoiceId_idx" ON "merchant_fees"("partnerId", "environment", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_fees_applicationId_kind_key" ON "merchant_fees"("applicationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_invoices_reference_key" ON "merchant_invoices"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_invoices_partnerId_environment_period_key" ON "merchant_invoices"("partnerId", "environment", "period");

-- AddForeignKey
ALTER TABLE "merchant_fees" ADD CONSTRAINT "merchant_fees_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "merchant_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Integrity: fees are positive, reversals negative; invoices never negative.
ALTER TABLE "merchant_fees" ADD CONSTRAINT "merchant_fees_sign_check" CHECK (("kind" = 'FEE' AND "feeKobo" >= 0) OR ("kind" = 'REVERSAL' AND "feeKobo" <= 0));
ALTER TABLE "merchant_fees" ADD CONSTRAINT "merchant_fees_bps_check" CHECK ("feeBps" BETWEEN 0 AND 10000);
