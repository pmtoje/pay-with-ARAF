-- Per-product annual profit rate, customer equity confirmation.
ALTER TABLE "partner_configurations" ADD COLUMN "annualProfitRateBps" INTEGER NOT NULL DEFAULT 2500;
ALTER TABLE "financing_applications" ADD COLUMN "contributionReference" TEXT;
ALTER TABLE "financing_applications" ADD COLUMN "contributionConfirmedAt" TIMESTAMP(3);
ALTER TABLE "financing_applications" ADD COLUMN "annualProfitRateBps" INTEGER NOT NULL DEFAULT 2500;
ALTER TABLE "financing_offers" ADD COLUMN "annualProfitRateBps" INTEGER NOT NULL DEFAULT 2500;
