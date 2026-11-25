'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, CardHeader, LoadingBlock, PageHeader, StatusBadge, Stepper } from '@araf/ui';
import { useApi } from '@/lib/hooks';
import { ActionDialog, ErrorAlert, Guard, Mono } from '@/components/common';
import { ConfigForm, ConfigSummary, PartnerDetailsForm, VendorManager, type PartnerDetail } from '@/components/partner-forms';
import { api } from '@/lib/api';
import { Icon } from '@/components/icons';

const STEPS = [
  { id: 'details', label: 'Partner details' },
  { id: 'config', label: 'Configuration' },
  { id: 'vendors', label: 'Vendors & settlement' },
  { id: 'submit', label: 'Review & submit' },
];

export default function NewPartnerPage() {
  return <Guard perm="partner.create"><Wizard /></Guard>;
}

function Wizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const partner = useApi<PartnerDetail>(partnerId ? `/api/admin/partners/${partnerId}` : null);
  useEffect(() => {
    document.title = 'Onboard partner · Pay with ARAF admin';
  }, []);
  const p = partner.data;
  const proposed = p?.configurations.find((c) => c.status === 'PENDING_APPROVAL');
  const hasAccount = p?.vendors.some((v) => v.settlement_accounts.length > 0) ?? false;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/partners" className="inline-flex items-center gap-1 hover:underline">{Icon.back('h-3.5 w-3.5')} Partners</Link>}
        title="Onboard a partner"
        description="Capture the partner, propose its financing configuration and settlement accounts, then submit for checker approval. The record is saved as a draft after step 1."
      />
      <div className="mb-6 max-w-3xl"><Stepper steps={STEPS} current={step} /></div>
      {p && (
        <p className="mb-4 text-sm text-muted">
          Draft <Mono>{p.partner_code}</Mono> · {p.trading_name} · <StatusBadge status={p.status} /> · <Link className="text-gold-strong hover:underline" href={`/partners/${p.id}`}>Open partner record</Link>
        </p>
      )}

      {step === 0 && (
        <Card>
          <CardHeader title="Partner details" description="Legal identity, contacts and risk classification." />
          <div className="p-5">
            {partnerId && !p ? <LoadingBlock /> : (
              <PartnerDetailsForm
                partnerId={partnerId ?? undefined}
                initial={p}
                submitLabel={partnerId ? 'Save and continue' : 'Create draft and continue'}
                onSaved={(r) => { setPartnerId(r.id); partner.reload(); setStep(1); }}
              />
            )}
          </div>
        </Card>
      )}

      {step === 1 && p && (
        <Card>
          <CardHeader title="Financing configuration" description="Limits, tenors, categories and return URLs. Activated on approval." actions={proposed ? <StatusBadge status={proposed.status} label={`v${proposed.version} proposed`} /> : undefined} />
          <div className="p-5">
            {proposed && <Alert tone="success" className="mb-5" title={`Configuration v${proposed.version} is saved`}>You can continue, or save again to replace it with a new proposed version.</Alert>}
            <ConfigForm partnerId={p.id} base={proposed} domains={p.domains} partnerStatus={p.status} onSaved={() => { partner.reload(); setStep(2); }} onCancel={() => setStep(0)} />
            {proposed && <div className="mt-4 flex justify-end"><Button variant="ghost" onClick={() => setStep(2)}>Skip — keep v{proposed.version} {Icon.chevron()}</Button></div>}
          </div>
        </Card>
      )}

      {step === 2 && p && (
        <Card>
          <CardHeader title="Vendors & settlement accounts" description="At least one vendor settlement account is required before submission." />
          <div className="p-5">
            <VendorManager partner={p} onChanged={partner.reload} />
            <div className="mt-6 flex justify-between gap-2 border-t border-border pt-4">
              <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)} disabled={!hasAccount}>Continue to review</Button>
            </div>
            {!hasAccount && <p className="mt-2 text-right text-xs text-muted">Add a settlement account to continue.</p>}
          </div>
        </Card>
      )}

      {step === 3 && p && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Partner" />
            <dl className="space-y-2 p-5 text-sm">
              {[['Trading name', p.trading_name], ['Registered name', p.registered_name], ['Type', p.partner_type], ['Registration', p.registration_number], ['Contact', `${p.contact_name} · ${p.contact_email}`], ['Risk', p.risk_classification]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-border pb-2 last:border-0"><dt className="text-muted">{k}</dt><dd className="text-right">{v}</dd></div>
              ))}
            </dl>
          </Card>
          <Card>
            <CardHeader title={proposed ? `Configuration v${proposed.version}` : 'Configuration'} />
            <div className="p-5">{proposed ? <ConfigSummary c={proposed} /> : <Alert tone="warning">No proposed configuration — go back to step 2.</Alert>}</div>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Submit for approval" />
            <div className="space-y-4 p-5">
              <p className="text-sm text-muted">
                Submitting moves the partner to <strong>Under review</strong> and creates a Partner onboarding request in the Approvals inbox. A Partner Approving Officer approves, rejects or requests more information. On approval, the sandbox environment is provisioned and the primary contact is invited.
              </p>
              <ul className="space-y-1 text-sm">
                <li className="flex items-center gap-2">{proposed ? <span className="text-success">{Icon.check()}</span> : <span className="text-danger">{Icon.x()}</span>} Proposed configuration</li>
                <li className="flex items-center gap-2">{hasAccount ? <span className="text-success">{Icon.check()}</span> : <span className="text-danger">{Icon.x()}</span>} At least one vendor settlement account</li>
              </ul>
              {partner.error ? <ErrorAlert error={partner.error} /> : null}
              <div className="flex justify-between gap-2">
                <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
                <Button variant="gold" onClick={() => setSubmitOpen(true)} disabled={!proposed || !hasAccount || !['DRAFT', 'ADDITIONAL_INFORMATION_REQUIRED'].includes(p.status)}>Submit for approval</Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {p && (
        <ActionDialog
          open={submitOpen}
          onClose={() => setSubmitOpen(false)}
          title={`Submit ${p.trading_name} for approval`}
          confirmLabel="Submit"
          tone="gold"
          reason={{ label: 'Comment for the checker', optional: true, hint: 'Optional — e.g. KYB documents verified.' }}
          onConfirm={(comment) => api.post(`/api/admin/partners/${p.id}/submit`, comment ? { comment } : {})}
          successMessage="Submitted — awaiting checker approval"
          onDone={() => router.push(`/partners/${p.id}`)}
        />
      )}
    </>
  );
}
