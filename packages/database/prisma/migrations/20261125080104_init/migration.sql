-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('STAFF', 'PARTNER');

-- CreateEnum
CREATE TYPE "Portal" AS ENUM ('ADMIN', 'PARTNER');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ADDITIONAL_INFORMATION_REQUIRED', 'APPROVED', 'SANDBOX_ACTIVE', 'PRODUCTION_PENDING', 'PRODUCTION_ACTIVE', 'SUSPENDED', 'REJECTED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('DIRECT_MERCHANT', 'MARKETPLACE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('CREATED', 'IDENTITY_PENDING', 'IDENTITY_VERIFIED', 'CREDIT_CHECK_PENDING', 'CREDIT_CHECK_COMPLETED', 'ENHANCED_REVIEW_REQUIRED', 'ENHANCED_REVIEW_PENDING', 'ENHANCED_REVIEW_CLEARED', 'ACCOUNT_VERIFICATION_PENDING', 'ACCOUNT_OPENING_PENDING', 'ACCOUNT_VERIFIED', 'STATEMENT_PENDING', 'STATEMENT_RECEIVED', 'STATEMENT_VALIDATION_PENDING', 'STATEMENT_ANALYSIS_PENDING', 'STATEMENT_ANALYSIS_COMPLETED', 'AFFORDABILITY_REVIEW_REQUIRED', 'ELIGIBLE', 'OFFER_PRESENTED', 'OFFER_ACCEPTED', 'ARAF_SUBMISSION_PENDING', 'ARAF_SUBMITTED', 'ARAF_UNDER_REVIEW', 'ADDITIONAL_INFORMATION_REQUIRED', 'FINANCING_APPROVED', 'DOCUMENTATION_PENDING', 'MANDATE_PENDING', 'BOOKING_PENDING', 'FINANCING_BOOKED', 'VENDOR_PAYMENT_PENDING', 'VENDOR_PAYMENT_CONFIRMED', 'RELEASE_AUTHORIZED', 'GOODS_DISPATCHED', 'GOODS_DELIVERED', 'COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "IncomeProfile" AS ENUM ('SALARY_EARNER', 'BUSINESS_OWNER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_INITIATED', 'PENDING_APPROVAL', 'INITIATED', 'PROCESSING', 'CONFIRMED', 'FAILED', 'UNKNOWN', 'REVERSED', 'RECONCILIATION_REQUIRED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "type" "UserType" NOT NULL,
    "partnerId" TEXT,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "UserType" NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "grantedById" TEXT,
    "approvalId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "portal" "Portal" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfTokenHash" TEXT NOT NULL,
    "mfaVerified" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TOTP',
    "secretEncrypted" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "lastUsedStep" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "type" "UserType" NOT NULL,
    "partnerId" TEXT,
    "roleCodes" TEXT[],
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "partnerId" TEXT,
    "payload" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "makerId" TEXT NOT NULL,
    "makerComment" TEXT,
    "checkerId" TEXT,
    "checkerComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "partnerCode" TEXT NOT NULL,
    "registeredName" TEXT NOT NULL,
    "tradingName" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "partnerType" "PartnerType" NOT NULL DEFAULT 'DIRECT_MERCHANT',
    "websiteUrl" TEXT NOT NULL,
    "businessAddress" TEXT NOT NULL,
    "businessCategory" TEXT NOT NULL,
    "taxIdentificationNumber" TEXT,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "technicalContactName" TEXT,
    "technicalContactEmail" TEXT,
    "riskClassification" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
    "status" "PartnerStatus" NOT NULL DEFAULT 'DRAFT',
    "agreementVersion" TEXT,
    "agreementAcceptedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_status_history" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "fromStatus" "PartnerStatus",
    "toStatus" "PartnerStatus" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "approvalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_configurations" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "minTransactionKobo" BIGINT NOT NULL,
    "maxTransactionKobo" BIGINT NOT NULL,
    "permittedProducts" TEXT[],
    "permittedTenors" INTEGER[],
    "eligibleCategories" TEXT[],
    "applicationExpiryMinutes" INTEGER NOT NULL DEFAULT 1440,
    "orderReservationMinutes" INTEGER NOT NULL DEFAULT 4320,
    "partialFinancingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "allowMultipleVendors" BOOLEAN NOT NULL DEFAULT false,
    "settlementArrangement" TEXT NOT NULL DEFAULT 'DIRECT_TO_VENDOR',
    "sandboxEnabled" BOOLEAN NOT NULL DEFAULT true,
    "productionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "makerId" TEXT,
    "checkerId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_domains" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_api_credentials" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "name" TEXT NOT NULL,
    "lookupPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "scopes" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "ipAllowlist" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "createdById" TEXT,
    "revokedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_api_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_webhook_endpoints" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "events" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "secretEncrypted" TEXT NOT NULL,
    "secretLast4" TEXT NOT NULL,
    "previousSecretEncrypted" TEXT,
    "previousSecretExpiresAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "vendorReference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "categories" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "isPartnerItself" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_settlement_accounts" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumberEncrypted" TEXT NOT NULL,
    "accountNumberMasked" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedName" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_settlement_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "bvnHash" TEXT NOT NULL,
    "bvnEncrypted" TEXT NOT NULL,
    "bvnLast4" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phoneMasked" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_accounts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "accountNumberEncrypted" TEXT NOT NULL,
    "accountNumberMasked" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_consents" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "customerId" TEXT,
    "consentType" TEXT NOT NULL,
    "lawfulBasis" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "provider" TEXT,
    "textHash" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "customer_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_orders" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "merchantOrderReference" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "amountKobo" BIGINT NOT NULL,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitAmountKobo" BIGINT NOT NULL,
    "lineAmountKobo" BIGINT NOT NULL,
    "category" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_sessions" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "orderId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "amountKobo" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "cartSnapshot" JSONB NOT NULL,
    "cartHash" TEXT NOT NULL,
    "returnUrl" TEXT NOT NULL,
    "cancelUrl" TEXT NOT NULL,
    "revisesSessionId" TEXT,
    "supersededById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sessions" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfTokenHash" TEXT NOT NULL,
    "authenticated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financing_applications" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "checkoutSessionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'CREATED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "incomeProfile" "IncomeProfile",
    "purchaseAmountKobo" BIGINT NOT NULL,
    "eligibleAmountKobo" BIGINT,
    "financingAmountKobo" BIGINT,
    "contributionAmountKobo" BIGINT NOT NULL DEFAULT 0,
    "contributionVerified" BOOLEAN NOT NULL DEFAULT false,
    "selectedAccountId" TEXT,
    "vendorId" TEXT NOT NULL,
    "creditPolicyVersionId" TEXT NOT NULL,
    "declineReasonCode" TEXT,
    "exceptionReturnState" "ApplicationStatus",
    "revisesApplicationId" TEXT,
    "arafReference" TEXT,
    "assignedOfficerId" TEXT,
    "holds" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financing_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_state_history" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "machine" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_state_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_verifications" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "bvnHash" TEXT NOT NULL,
    "bvnLast4" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failureCode" TEXT,
    "providerReference" TEXT,
    "phoneMasked" TEXT,
    "firstNameEnc" TEXT,
    "lastNameEnc" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "identity_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "identityVerificationId" TEXT,
    "customerSessionId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destinationMasked" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resendAvailableAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_policies" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "credit_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_policy_versions" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "rules" JSONB NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "isProposed" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3),
    "makerId" TEXT,
    "checkerId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_assessments" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" INTEGER,
    "band" TEXT,
    "outcome" TEXT,
    "policyVersionId" TEXT NOT NULL,
    "providerReference" TEXT,
    "bureauMonthlyObligationsKobo" BIGINT,
    "outstandingExposureKobo" BIGINT,
    "delinquencyIndicators" TEXT[],
    "failureCode" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "assessedAt" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enhanced_reviews" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "formDataEncrypted" TEXT,
    "requestedFields" TEXT[],
    "clarificationNote" TEXT,
    "assignedToId" TEXT,
    "slaDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enhanced_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_decisions" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" TEXT,
    "reviewerId" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "approvalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'EFFECTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_opening_requests" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "correlationRef" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "verifiedAccountId" TEXT,
    "failureCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redirectedAt" TIMESTAMP(3),
    "callbackAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_opening_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stored_documents" (
    "id" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "partnerId" TEXT,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_connections" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerReference" TEXT,
    "accountId" TEXT,
    "documentId" TEXT,
    "periodStart" TEXT,
    "periodEnd" TEXT,
    "requiredMonths" INTEGER NOT NULL,
    "ownershipConfidence" TEXT,
    "validationFindings" TEXT[],
    "normalizedEncrypted" TEXT,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "statement_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_analysis_jobs" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerJobRef" TEXT,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statement_analysis_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_analysis_results" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "analysisReference" TEXT NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "ownershipConfidence" TEXT NOT NULL,
    "averageMonthlyInflowKobo" BIGINT NOT NULL,
    "averageMonthlyOutflowKobo" BIGINT NOT NULL,
    "averageBalanceKobo" BIGINT NOT NULL,
    "recurringObligationsKobo" BIGINT NOT NULL,
    "existingFinancingRepaymentsKobo" BIGINT NOT NULL,
    "businessRevenueMonthlyKobo" BIGINT,
    "salaryCreditsEncrypted" TEXT NOT NULL,
    "stressIndicators" TEXT[],
    "statementQuality" TEXT NOT NULL,
    "cashFlowConsistency" TEXT,
    "providerRecommendedAmountKobo" BIGINT,
    "confidence" TEXT NOT NULL,
    "reliable" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statement_analysis_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affordability_assessments" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "analysisResultId" TEXT,
    "incomeProfile" "IncomeProfile" NOT NULL,
    "outcome" TEXT NOT NULL,
    "reasons" TEXT[],
    "recognisedMonthlyIncomeKobo" BIGINT,
    "existingMonthlyObligationsKobo" BIGINT,
    "capacityKobo" BIGINT,
    "existingExposureKobo" BIGINT,
    "remainingExposureKobo" BIGINT,
    "maxEligibleKobo" BIGINT,
    "tenorBreakdown" JSONB,
    "monthBreakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affordability_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exposure_reservations" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exposure_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financing_offers" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "purchaseAmountKobo" BIGINT NOT NULL,
    "financingAmountKobo" BIGINT NOT NULL,
    "contributionKobo" BIGINT NOT NULL,
    "tenorMonths" INTEGER NOT NULL,
    "markupBps" INTEGER NOT NULL,
    "profitKobo" BIGINT NOT NULL,
    "deferredSalePriceKobo" BIGINT NOT NULL,
    "monthlyRepaymentKobo" BIGINT NOT NULL,
    "feesKobo" BIGINT NOT NULL DEFAULT 0,
    "termsVersion" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financing_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repayment_schedules" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "dueDate" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,

    CONSTRAINT "repayment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_acceptances" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "termsHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "araf_submissions" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "arafReference" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "araf_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "araf_status_events" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "arafReference" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "decision" TEXT,
    "note" TEXT,
    "actorName" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "araf_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractual_conditions" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "evidenceRef" TEXT,
    "satisfiedById" TEXT,
    "satisfiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contractual_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financing_documents" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3),
    "signatureEvidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financing_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repayment_mandates" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mandateReference" TEXT,
    "authorizationUrl" TEXT,
    "failureCode" TEXT,
    "activatedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repayment_mandates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_records" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "arafApprovalReference" TEXT,
    "financingAmountKobo" BIGINT NOT NULL,
    "profitKobo" BIGINT NOT NULL,
    "deferredSalePriceKobo" BIGINT NOT NULL,
    "tenorMonths" INTEGER NOT NULL,
    "bookingReference" TEXT,
    "failureCode" TEXT,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3),
    "bookedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_payment_instructions" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "vendorId" TEXT NOT NULL,
    "settlementAccountId" TEXT NOT NULL,
    "beneficiaryName" TEXT NOT NULL,
    "beneficiaryAccountMasked" TEXT NOT NULL,
    "beneficiaryBankName" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "providerReference" TEXT,
    "confirmedByAuthoritativeSource" BOOLEAN NOT NULL DEFAULT false,
    "isSimulated" BOOLEAN NOT NULL,
    "initiatedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvalId" TEXT,
    "failureReason" TEXT,
    "reconciliationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "initiatedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_payment_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_payment_events" (
    "id" TEXT NOT NULL,
    "instructionId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "providerReference" TEXT,
    "amountKobo" BIGINT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "triggeredBy" TEXT NOT NULL,
    "checked" INTEGER NOT NULL DEFAULT 0,
    "discrepancies" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reconciliations" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "applicationId" TEXT,
    "instructionId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_authorizations" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentInstructionId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "authorizedItems" JSONB NOT NULL,
    "authorizedAmountKobo" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "conditionsSnapshot" JSONB NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "contractReferences" TEXT[],
    "isSimulated" BOOLEAN NOT NULL,
    "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspendedAt" TIMESTAMP(3),
    "suspensionReason" TEXT,

    CONSTRAINT "release_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfilment_records" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trackingReference" TEXT,
    "carrier" TEXT,
    "note" TEXT,
    "evidenceDocumentId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfilment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellation_requests" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "initiatedBy" TEXT NOT NULL,
    "actorId" TEXT,
    "stage" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requiresReversal" BOOLEAN NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cancellation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_requests" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "initiatedBy" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_records" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "returnRequestId" TEXT,
    "cancellationId" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'VENDOR_TO_BANK',
    "expectedAmountKobo" BIGINT NOT NULL,
    "receivedAmountKobo" BIGINT,
    "status" TEXT NOT NULL,
    "approvalId" TEXT,
    "providerReference" TEXT,
    "isSimulated" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "type" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT '1.0',
    "applicationRef" TEXT,
    "merchantOrderReference" TEXT,
    "resourceVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "succeededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_delivery_attempts" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "statusCode" INTEGER,
    "durationMs" INTEGER NOT NULL,
    "error" TEXT,
    "responseSnippet" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER,
    "responseBody" JSONB,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "audience" TEXT NOT NULL,
    "recipientRef" TEXT NOT NULL,
    "partnerId" TEXT,
    "applicationId" TEXT,
    "channel" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerRef" TEXT,
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sandbox_messages" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "channel" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sandbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "actorRoles" TEXT[],
    "partnerId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "correlationId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "approvalRef" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'SUCCESS',
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_logs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "isSimulated" BOOLEAN NOT NULL,
    "applicationId" TEXT,
    "correlationId" TEXT,
    "outcome" TEXT NOT NULL,
    "errorCode" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_exceptions" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "applicationId" TEXT,
    "partnerId" TEXT,
    "environment" "Environment" NOT NULL,
    "severity" TEXT NOT NULL,
    "responsibleTeam" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "retryEligible" BOOLEAN NOT NULL,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "customerMessage" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "assignedToId" TEXT,
    "resolution" TEXT,
    "history" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "operational_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_sequences" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "reference_sequences_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "sim_araf_cases" (
    "id" TEXT NOT NULL,
    "arafReference" TEXT NOT NULL,
    "applicationRef" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "submission" JSONB NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "assignedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sim_araf_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_araf_actions" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_araf_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_records" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sim_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_partnerId_idx" ON "users"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "mfa_credentials_userId_idx" ON "mfa_credentials"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_invitations_tokenHash_key" ON "user_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "user_invitations_email_idx" ON "user_invitations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_reference_key" ON "approval_requests"("reference");

-- CreateIndex
CREATE INDEX "approval_requests_type_status_idx" ON "approval_requests"("type", "status");

-- CreateIndex
CREATE INDEX "approval_requests_resourceType_resourceId_idx" ON "approval_requests"("resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "partners_partnerCode_key" ON "partners"("partnerCode");

-- CreateIndex
CREATE INDEX "partner_status_history_partnerId_idx" ON "partner_status_history"("partnerId");

-- CreateIndex
CREATE INDEX "partner_configurations_partnerId_status_idx" ON "partner_configurations"("partnerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "partner_configurations_partnerId_version_key" ON "partner_configurations"("partnerId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "partner_domains_partnerId_environment_kind_value_key" ON "partner_domains"("partnerId", "environment", "kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "partner_api_credentials_lookupPrefix_key" ON "partner_api_credentials"("lookupPrefix");

-- CreateIndex
CREATE INDEX "partner_api_credentials_partnerId_environment_idx" ON "partner_api_credentials"("partnerId", "environment");

-- CreateIndex
CREATE INDEX "partner_webhook_endpoints_partnerId_environment_idx" ON "partner_webhook_endpoints"("partnerId", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_partnerId_environment_vendorReference_key" ON "vendors"("partnerId", "environment", "vendorReference");

-- CreateIndex
CREATE INDEX "vendor_settlement_accounts_vendorId_status_idx" ON "vendor_settlement_accounts"("vendorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customers_environment_bvnHash_key" ON "customers"("environment", "bvnHash");

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_customerId_accountNumberMasked_productNam_key" ON "customer_accounts"("customerId", "accountNumberMasked", "productName");

-- CreateIndex
CREATE INDEX "customer_consents_applicationId_idx" ON "customer_consents"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_orders_partnerId_environment_merchantOrderReferenc_key" ON "merchant_orders"("partnerId", "environment", "merchantOrderReference");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "checkout_sessions_partnerId_environment_idx" ON "checkout_sessions"("partnerId", "environment");

-- CreateIndex
CREATE INDEX "checkout_sessions_orderId_idx" ON "checkout_sessions"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sessions_tokenHash_key" ON "customer_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "customer_sessions_applicationId_idx" ON "customer_sessions"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "financing_applications_reference_key" ON "financing_applications"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "financing_applications_checkoutSessionId_key" ON "financing_applications"("checkoutSessionId");

-- CreateIndex
CREATE INDEX "financing_applications_partnerId_environment_status_idx" ON "financing_applications"("partnerId", "environment", "status");

-- CreateIndex
CREATE INDEX "financing_applications_customerId_idx" ON "financing_applications"("customerId");

-- CreateIndex
CREATE INDEX "financing_applications_status_idx" ON "financing_applications"("status");

-- CreateIndex
CREATE INDEX "financing_applications_createdAt_idx" ON "financing_applications"("createdAt");

-- CreateIndex
CREATE INDEX "application_state_history_applicationId_createdAt_idx" ON "application_state_history"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "application_state_history_machine_entityId_idx" ON "application_state_history"("machine", "entityId");

-- CreateIndex
CREATE INDEX "identity_verifications_applicationId_idx" ON "identity_verifications"("applicationId");

-- CreateIndex
CREATE INDEX "identity_verifications_bvnHash_createdAt_idx" ON "identity_verifications"("bvnHash", "createdAt");

-- CreateIndex
CREATE INDEX "otp_challenges_applicationId_purpose_idx" ON "otp_challenges"("applicationId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "credit_policies_code_key" ON "credit_policies"("code");

-- CreateIndex
CREATE UNIQUE INDEX "credit_policy_versions_policyId_version_key" ON "credit_policy_versions"("policyId", "version");

-- CreateIndex
CREATE INDEX "credit_assessments_applicationId_idx" ON "credit_assessments"("applicationId");

-- CreateIndex
CREATE INDEX "credit_assessments_customerId_assessedAt_idx" ON "credit_assessments"("customerId", "assessedAt");

-- CreateIndex
CREATE INDEX "enhanced_reviews_queue_status_idx" ON "enhanced_reviews"("queue", "status");

-- CreateIndex
CREATE INDEX "enhanced_reviews_applicationId_idx" ON "enhanced_reviews"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "account_opening_requests_correlationRef_key" ON "account_opening_requests"("correlationRef");

-- CreateIndex
CREATE INDEX "account_opening_requests_applicationId_idx" ON "account_opening_requests"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "stored_documents_storageKey_key" ON "stored_documents"("storageKey");

-- CreateIndex
CREATE INDEX "stored_documents_ownerType_ownerId_idx" ON "stored_documents"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "stored_documents_sha256_idx" ON "stored_documents"("sha256");

-- CreateIndex
CREATE INDEX "statement_connections_applicationId_idx" ON "statement_connections"("applicationId");

-- CreateIndex
CREATE INDEX "statement_analysis_jobs_applicationId_idx" ON "statement_analysis_jobs"("applicationId");

-- CreateIndex
CREATE INDEX "statement_analysis_jobs_status_idx" ON "statement_analysis_jobs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "statement_analysis_results_jobId_key" ON "statement_analysis_results"("jobId");

-- CreateIndex
CREATE INDEX "statement_analysis_results_applicationId_idx" ON "statement_analysis_results"("applicationId");

-- CreateIndex
CREATE INDEX "affordability_assessments_applicationId_idx" ON "affordability_assessments"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "exposure_reservations_applicationId_key" ON "exposure_reservations"("applicationId");

-- CreateIndex
CREATE INDEX "exposure_reservations_customerId_status_idx" ON "exposure_reservations"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "financing_offers_reference_key" ON "financing_offers"("reference");

-- CreateIndex
CREATE INDEX "financing_offers_applicationId_status_idx" ON "financing_offers"("applicationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "repayment_schedules_offerId_number_key" ON "repayment_schedules"("offerId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "offer_acceptances_offerId_key" ON "offer_acceptances"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "araf_submissions_applicationId_key" ON "araf_submissions"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "araf_submissions_idempotencyKey_key" ON "araf_submissions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "araf_status_events_eventId_key" ON "araf_status_events"("eventId");

-- CreateIndex
CREATE INDEX "araf_status_events_applicationId_sequence_idx" ON "araf_status_events"("applicationId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "contractual_conditions_applicationId_code_key" ON "contractual_conditions"("applicationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "financing_documents_applicationId_docType_version_key" ON "financing_documents"("applicationId", "docType", "version");

-- CreateIndex
CREATE UNIQUE INDEX "repayment_mandates_applicationId_key" ON "repayment_mandates"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_records_applicationId_key" ON "booking_records"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_records_idempotencyKey_key" ON "booking_records"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_payment_instructions_reference_key" ON "vendor_payment_instructions"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_payment_instructions_idempotencyKey_key" ON "vendor_payment_instructions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "vendor_payment_instructions_applicationId_idx" ON "vendor_payment_instructions"("applicationId");

-- CreateIndex
CREATE INDEX "vendor_payment_instructions_partnerId_environment_status_idx" ON "vendor_payment_instructions"("partnerId", "environment", "status");

-- CreateIndex
CREATE INDEX "vendor_payment_events_instructionId_idx" ON "vendor_payment_events"("instructionId");

-- CreateIndex
CREATE INDEX "payment_reconciliations_status_idx" ON "payment_reconciliations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "release_authorizations_reference_key" ON "release_authorizations"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "release_authorizations_applicationId_key" ON "release_authorizations"("applicationId");

-- CreateIndex
CREATE INDEX "release_authorizations_partnerId_environment_status_idx" ON "release_authorizations"("partnerId", "environment", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fulfilment_records_applicationId_status_key" ON "fulfilment_records"("applicationId", "status");

-- CreateIndex
CREATE INDEX "cancellation_requests_applicationId_idx" ON "cancellation_requests"("applicationId");

-- CreateIndex
CREATE INDEX "return_requests_applicationId_idx" ON "return_requests"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "refund_records_reference_key" ON "refund_records"("reference");

-- CreateIndex
CREATE INDEX "refund_records_applicationId_idx" ON "refund_records"("applicationId");

-- CreateIndex
CREATE INDEX "outbox_events_processedAt_availableAt_idx" ON "outbox_events"("processedAt", "availableAt");

-- CreateIndex
CREATE INDEX "webhook_events_partnerId_environment_createdAt_idx" ON "webhook_events"("partnerId", "environment", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_nextAttemptAt_idx" ON "webhook_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_eventId_endpointId_key" ON "webhook_deliveries"("eventId", "endpointId");

-- CreateIndex
CREATE INDEX "webhook_delivery_attempts_deliveryId_idx" ON "webhook_delivery_attempts"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_code_channel_version_key" ON "notification_templates"("code", "channel", "version");

-- CreateIndex
CREATE INDEX "notifications_audience_recipientRef_idx" ON "notifications"("audience", "recipientRef");

-- CreateIndex
CREATE INDEX "notifications_partnerId_idx" ON "notifications"("partnerId");

-- CreateIndex
CREATE INDEX "notifications_applicationId_idx" ON "notifications"("applicationId");

-- CreateIndex
CREATE INDEX "sandbox_messages_applicationId_idx" ON "sandbox_messages"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_sequence_key" ON "audit_logs"("sequence");

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_partnerId_idx" ON "audit_logs"("partnerId");

-- CreateIndex
CREATE INDEX "audit_logs_occurredAt_idx" ON "audit_logs"("occurredAt");

-- CreateIndex
CREATE INDEX "integration_logs_provider_createdAt_idx" ON "integration_logs"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "integration_logs_applicationId_idx" ON "integration_logs"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "operational_exceptions_reference_key" ON "operational_exceptions"("reference");

-- CreateIndex
CREATE INDEX "operational_exceptions_status_category_idx" ON "operational_exceptions"("status", "category");

-- CreateIndex
CREATE INDEX "operational_exceptions_applicationId_idx" ON "operational_exceptions"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "sim_araf_cases_arafReference_key" ON "sim_araf_cases"("arafReference");

-- CreateIndex
CREATE UNIQUE INDEX "sim_araf_cases_applicationRef_key" ON "sim_araf_cases"("applicationRef");

-- CreateIndex
CREATE UNIQUE INDEX "sim_araf_cases_idempotencyKey_key" ON "sim_araf_cases"("idempotencyKey");

-- CreateIndex
CREATE INDEX "sim_araf_actions_caseId_idx" ON "sim_araf_actions"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "sim_records_kind_key_key" ON "sim_records"("kind", "key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_credentials" ADD CONSTRAINT "mfa_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_status_history" ADD CONSTRAINT "partner_status_history_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_configurations" ADD CONSTRAINT "partner_configurations_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_domains" ADD CONSTRAINT "partner_domains_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_api_credentials" ADD CONSTRAINT "partner_api_credentials_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_webhook_endpoints" ADD CONSTRAINT "partner_webhook_endpoints_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_settlement_accounts" ADD CONSTRAINT "vendor_settlement_accounts_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "merchant_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "merchant_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financing_applications" ADD CONSTRAINT "financing_applications_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "checkout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_policy_versions" ADD CONSTRAINT "credit_policy_versions_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "credit_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "enhanced_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_analysis_results" ADD CONSTRAINT "statement_analysis_results_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "statement_analysis_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repayment_schedules" ADD CONSTRAINT "repayment_schedules_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "financing_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payment_events" ADD CONSTRAINT "vendor_payment_events_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "vendor_payment_instructions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reconciliations" ADD CONSTRAINT "payment_reconciliations_runId_fkey" FOREIGN KEY ("runId") REFERENCES "reconciliation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "webhook_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "partner_webhook_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "webhook_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_araf_actions" ADD CONSTRAINT "sim_araf_actions_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "sim_araf_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
