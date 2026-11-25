-- CreateTable
CREATE TABLE "araf_outbound_reports" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "arafReference" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "arafEventReference" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "araf_outbound_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "araf_outbound_reports_status_nextAttemptAt_idx" ON "araf_outbound_reports"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "araf_outbound_reports_applicationId_sequence_key" ON "araf_outbound_reports"("applicationId", "sequence");
