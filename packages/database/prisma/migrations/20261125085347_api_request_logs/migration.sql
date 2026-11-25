-- CreateTable
CREATE TABLE "api_request_logs" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "credentialId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "correlationId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_request_logs_partnerId_createdAt_idx" ON "api_request_logs"("partnerId", "createdAt");
