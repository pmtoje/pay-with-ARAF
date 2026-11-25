/**
 * Error catalogue (spec §55). Every error has an internal code, a safe message,
 * an HTTP status, the responsible team, and whether retry is meaningful.
 * Messages never expose stack traces, SQL or internal architecture.
 */

export interface ErrorDefinition {
  status: number;
  message: string;
  team: 'CUSTOMER' | 'PARTNER' | 'TECHNOLOGY' | 'CREDIT' | 'OPERATIONS' | 'CAD' | 'SETTLEMENT' | 'SECURITY';
  retryable: boolean;
}

const E = (status: number, message: string, team: ErrorDefinition['team'], retryable = false): ErrorDefinition => ({
  status,
  message,
  team,
  retryable,
});

export const ERRORS = {
  // Generic
  VALIDATION_FAILED: E(422, 'The request contains invalid or missing fields.', 'PARTNER'),
  NOT_FOUND: E(404, 'The requested resource was not found.', 'PARTNER'),
  UNAUTHENTICATED: E(401, 'Authentication is required.', 'SECURITY'),
  FORBIDDEN: E(403, 'You do not have permission to perform this action.', 'SECURITY'),
  CSRF_FAILED: E(403, 'Your session could not be verified. Please refresh and try again.', 'SECURITY'),
  RATE_LIMITED: E(429, 'Too many requests. Please wait and try again.', 'SECURITY', true),
  CONFLICT: E(409, 'The resource was modified by another request. Please retry.', 'TECHNOLOGY', true),
  INVALID_STATE: E(409, 'This action is not available at the current stage.', 'TECHNOLOGY'),
  INTERNAL_ERROR: E(500, 'Something went wrong on our side. Please try again later.', 'TECHNOLOGY', true),
  INTEGRATION_NOT_CONFIGURED: E(503, 'This service is not yet available.', 'TECHNOLOGY'),
  MAKER_CHECKER_VIOLATION: E(403, 'The approver must be a different user from the requester.', 'SECURITY'),
  // Auth
  INVALID_CREDENTIALS: E(401, 'The email or password is incorrect.', 'SECURITY'),
  ACCOUNT_LOCKED: E(423, 'This account is temporarily locked. Please try again later or contact support.', 'SECURITY'),
  MFA_REQUIRED: E(401, 'Multi-factor authentication is required.', 'SECURITY'),
  MFA_INVALID: E(401, 'The authentication code is invalid or has expired.', 'SECURITY'),
  SESSION_EXPIRED: E(401, 'Your session has expired. Please verify again to continue.', 'CUSTOMER'),
  // Partner API
  INVALID_API_KEY: E(401, 'Invalid API key.', 'PARTNER'),
  API_KEY_ENVIRONMENT_MISMATCH: E(403, 'This API key cannot access the requested environment.', 'PARTNER'),
  INSUFFICIENT_SCOPE: E(403, 'This API key is not permitted to perform this action.', 'PARTNER'),
  IP_NOT_ALLOWED: E(403, 'Requests from this IP address are not permitted for this API key.', 'PARTNER'),
  PARTNER_NOT_ACTIVE: E(403, 'This partner account is not active for the requested environment.', 'PARTNER'),
  IDEMPOTENCY_KEY_REUSED: E(422, 'This Idempotency-Key was already used with a different request.', 'PARTNER'),
  IDEMPOTENCY_IN_PROGRESS: E(409, 'A request with this Idempotency-Key is still being processed.', 'PARTNER', true),
  CART_INVALID: E(422, 'The cart failed validation.', 'PARTNER'),
  RETURN_URL_NOT_APPROVED: E(422, 'The return or cancel URL is not on the approved list for this partner.', 'PARTNER'),
  DUPLICATE_CHECKOUT: E(409, 'An active checkout session already exists for this order.', 'PARTNER'),
  VENDOR_NOT_ELIGIBLE: E(422, 'The vendor is not approved for financing.', 'PARTNER'),
  CHECKOUT_EXPIRED: E(410, 'This checkout session has expired. Please return to the merchant to start again.', 'CUSTOMER'),
  // Customer journey
  INVALID_BVN: E(422, 'Please enter a valid 11-digit BVN.', 'CUSTOMER'),
  IDENTITY_MISMATCH: E(422, 'We could not verify these details. Please check your BVN and date of birth.', 'CUSTOMER'),
  AGE_NOT_ELIGIBLE: E(422, 'You do not meet the age requirement for this financing product.', 'CUSTOMER'),
  IDENTITY_PROVIDER_UNAVAILABLE: E(503, 'Identity verification is temporarily unavailable. Please try again shortly.', 'TECHNOLOGY', true),
  IDENTITY_LOCKED: E(423, 'Too many verification attempts. Please try again later.', 'CUSTOMER'),
  OTP_EXPIRED: E(422, 'This code has expired. Please request a new code.', 'CUSTOMER'),
  OTP_INVALID: E(422, 'The code you entered is incorrect.', 'CUSTOMER'),
  OTP_ATTEMPTS_EXCEEDED: E(423, 'Too many incorrect attempts. Please request a new code.', 'CUSTOMER'),
  OTP_RESEND_COOLDOWN: E(429, 'Please wait before requesting another code.', 'CUSTOMER', true),
  CONSENT_REQUIRED: E(422, 'Please review and accept the required consents to continue.', 'CUSTOMER'),
  CREDIT_PROVIDER_UNAVAILABLE: E(503, 'We could not complete your eligibility check right now. Please try again shortly.', 'TECHNOLOGY', true),
  CREDIT_INVALID_RESPONSE: E(503, 'We could not complete your eligibility check right now. Please try again shortly.', 'TECHNOLOGY', true),
  ACCOUNT_NOT_ELIGIBLE: E(422, 'This account cannot be used for financing repayments.', 'CUSTOMER'),
  ACCOUNT_OPENING_INCOMPLETE: E(409, 'We have not yet confirmed your new account. Please complete account opening and try again.', 'CUSTOMER', true),
  STATEMENT_COVERAGE_INSUFFICIENT: E(422, 'This statement does not cover the required period.', 'CUSTOMER'),
  STATEMENT_OWNERSHIP_MISMATCH: E(422, 'This statement does not appear to belong to the verified customer.', 'CUSTOMER'),
  PDF_INVALID: E(422, 'This file is not a valid bank-issued PDF statement.', 'CUSTOMER'),
  PDF_TOO_LARGE: E(413, 'This file is larger than the permitted size.', 'CUSTOMER'),
  PDF_ENCRYPTED: E(422, 'This PDF is password protected. Please upload an unprotected statement or use another option.', 'CUSTOMER'),
  MALWARE_DETECTED: E(422, 'This file could not be accepted.', 'SECURITY'),
  DUPLICATE_DOCUMENT: E(409, 'This statement has already been uploaded.', 'CUSTOMER'),
  MONO_CONNECTION_FAILED: E(502, 'We could not connect to your bank. Please try again or use another option.', 'TECHNOLOGY', true),
  ANALYSIS_PROVIDER_UNAVAILABLE: E(503, 'Statement analysis is temporarily unavailable. Please try again shortly.', 'TECHNOLOGY', true),
  OFFER_EXPIRED: E(410, 'This offer has expired. Please request a new offer.', 'CUSTOMER'),
  OFFER_NOT_AFFORDABLE: E(422, 'This option exceeds your eligible repayment capacity.', 'CUSTOMER'),
  TENOR_NOT_SUPPORTED: E(422, 'This repayment period is not available.', 'CUSTOMER'),
  EXPOSURE_LIMIT_EXCEEDED: E(422, 'The requested amount exceeds the financing limit available to you.', 'CREDIT'),
  // Operations
  ARAF_UNAVAILABLE: E(503, 'Application processing is delayed. We will continue automatically.', 'TECHNOLOGY', true),
  PRECONDITIONS_NOT_MET: E(409, 'Required conditions for this action are not yet satisfied.', 'OPERATIONS'),
  DUPLICATE_PAYMENT_ATTEMPT: E(409, 'A payment instruction already exists for this application.', 'SETTLEMENT'),
  PAYMENT_STATUS_UNKNOWN: E(409, 'The payment status is unknown and must be reconciled before any retry.', 'SETTLEMENT'),
  RELEASE_NOT_AUTHORIZED: E(409, 'Goods release has not been authorised for this order.', 'PARTNER'),
  FULFILMENT_DUPLICATE: E(409, 'This fulfilment step was already recorded.', 'PARTNER'),
  WEBHOOK_URL_UNSAFE: E(422, 'The webhook URL is not permitted. Use a public HTTPS endpoint.', 'PARTNER'),
  PRODUCTION_LOCKED: E(403, 'Production operation is not enabled. Required approvals and integrations are outstanding.', 'SECURITY'),
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERRORS;
