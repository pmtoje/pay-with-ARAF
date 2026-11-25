'use client';

import { useCheckout } from './context';
import { IdentityStep } from './steps/Identity';
import { ResumeStep } from './steps/Resume';
import { CreditCheckStep, CreditCheckingStep } from './steps/Credit';
import { EnhancedPendingStep, EnhancedReviewStep } from './steps/Enhanced';
import { AccountOpeningPendingStep, AccountStep } from './steps/Account';
import { IncomeProfileStep } from './steps/Income';
import { StatementsStep } from './steps/Statements';
import { AffordabilityReviewStep, AnalysisStep } from './steps/Analysis';
import { OfferStep } from './steps/Offer';
import { SubmissionStep } from './steps/Submission';
import { EndedStep, TrackingStep } from './steps/Tracking';

export function StepRouter() {
  const { view } = useCheckout();
  const s = view.state;
  if (s === 'CREATED' || s === 'IDENTITY_PENDING') return <IdentityStep />;
  if (view.needs_reauthentication || !view.authenticated) return <ResumeStep />;
  switch (s) {
    case 'IDENTITY_VERIFIED':
    case 'CREDIT_CHECK_PENDING':
      return <CreditCheckStep />;
    case 'CREDIT_CHECK_COMPLETED':
      return <CreditCheckingStep />;
    case 'ENHANCED_REVIEW_REQUIRED':
      return <EnhancedReviewStep />;
    case 'ENHANCED_REVIEW_PENDING':
      return <EnhancedPendingStep />;
    case 'ENHANCED_REVIEW_CLEARED':
    case 'ACCOUNT_VERIFICATION_PENDING':
      return <AccountStep />;
    case 'ACCOUNT_OPENING_PENDING':
      return <AccountOpeningPendingStep />;
    case 'ACCOUNT_VERIFIED':
      return <IncomeProfileStep />;
    case 'STATEMENT_PENDING':
      return view.income_profile ? <StatementsStep /> : <IncomeProfileStep />;
    case 'STATEMENT_RECEIVED':
    case 'STATEMENT_VALIDATION_PENDING':
    case 'STATEMENT_ANALYSIS_PENDING':
    case 'STATEMENT_ANALYSIS_COMPLETED':
      return <AnalysisStep />;
    case 'AFFORDABILITY_REVIEW_REQUIRED':
      return <AffordabilityReviewStep />;
    case 'ELIGIBLE':
    case 'OFFER_PRESENTED':
      return <OfferStep />;
    case 'OFFER_ACCEPTED':
    case 'ARAF_SUBMISSION_PENDING':
      return <SubmissionStep />;
    case 'DECLINED':
    case 'CANCELLED':
    case 'EXPIRED':
      return <EndedStep />;
    default:
      return <TrackingStep />;
  }
}
