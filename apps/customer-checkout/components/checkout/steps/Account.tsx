'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Skeleton } from '@araf/ui';
import { safeHref } from '@/lib/api';
import type { AccountRow } from '@/lib/types';
import { useAction, useCheckout } from '../context';
import { ChoiceCard, ErrorNotice, StepCard, Why } from '../ui';

function useAccountOpening() {
  const { api, base } = useCheckout();
  const { busy, error, run } = useAction();
  const start = () =>
    run('open-account', async () => {
      const r = await api.post<{ redirect_url: string }>(`${base}/account-opening/start`);
      const url = safeHref(r.redirect_url);
      if (!url) throw new Error('The account opening link is not valid. Please try again.');
      window.location.assign(url);
      // Keep the button busy while the browser navigates away.
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    });
  return { busy, error, start };
}

export function AccountStep() {
  const { api, base, view } = useCheckout();
  const { busy, error, run } = useAction();
  const opening = useAccountOpening();
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string>('');

  const load = useCallback(async () => {
    setLoadError(null);
    setAccounts(null);
    try {
      const r = await api.get<{ accounts: AccountRow[] }>(`${base}/accounts`);
      setAccounts(r.accounts);
      const eligible = r.accounts.filter((a) => a.eligible);
      if (eligible.length === 1) setSelected(eligible[0].id);
    } catch (e) {
      setLoadError(e);
    }
  }, [api, base]);
  useEffect(() => {
    void load();
  }, [load]);

  const first = view.customer?.first_name;
  const hasEligible = (accounts ?? []).some((a) => a.eligible);

  return (
    <StepCard
      eyebrow="Step 2 · Confirm eligibility"
      title={first ? `Good news, ${first} — let’s set up repayments` : 'Choose your repayment account'}
      description="You passed the preliminary eligibility check. Repayments are collected from an Alternative Bank account in your name."
    >
      <div aria-live="polite" aria-busy={!accounts && !loadError}>
        {loadError ? (
          <ErrorNotice error={loadError} action={<Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button>} />
        ) : !accounts ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <span className="sr-only">Looking for Alternative Bank accounts linked to your BVN…</span>
          </div>
        ) : accounts.length === 0 ? (
          <div className="rounded-md border border-dashed border-border-strong px-4 py-5 text-sm text-muted">
            <p className="font-medium text-fg">We didn’t find an Alternative Bank account linked to your BVN.</p>
            <p className="mt-1">You can open one online in a few minutes, then come straight back here.</p>
          </div>
        ) : (
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-semibold text-fg">Accounts linked to your BVN</legend>
            {accounts.map((a) => (
              <ChoiceCard
                key={a.id}
                name="account"
                value={a.id}
                checked={selected === a.id}
                onChange={setSelected}
                disabled={!a.eligible}
                title={
                  <>
                    {a.product} <span className="font-mono font-normal text-muted">{a.account_number}</span>
                  </>
                }
                badge={!a.eligible ? <Badge tone="neutral">{a.status.replace(/_/g, ' ').toLowerCase()}</Badge> : undefined}
                description={a.eligible ? a.account_name : a.ineligible_reason ?? 'This account cannot be used for repayments.'}
              />
            ))}
          </fieldset>
        )}
      </div>

      {accounts && accounts.length > 0 && (
        <>
          <ErrorNotice error={error} />
          <Button size="lg" block disabled={!selected || !!opening.busy} loading={busy === 'select'} onClick={() => void run('select', () => api.post(`${base}/accounts/select`, { account_id: selected }))}>
            {(() => {
              const a = accounts.find((x) => x.id === selected);
              return a ? `Use ${a.account_number} for my repayments` : 'Choose an account for repayments';
            })()}
          </Button>
        </>
      )}

      {accounts && (
        <div className={accounts.length > 0 ? 'border-t border-border pt-5' : ''}>
          {accounts.length > 0 && <p className="mb-3 text-sm text-muted">{hasEligible ? 'Prefer a new account for this purchase?' : 'None of these accounts can be used for repayments.'}</p>}
          <ErrorNotice error={opening.error} className="mb-3" />
          <Button size="lg" block variant={accounts.length === 0 ? 'primary' : 'secondary'} loading={opening.busy === 'open-account'} disabled={!!busy} onClick={() => void opening.start()}>
            Open an Alternative Bank account
          </Button>
          <p className="mt-2 text-xs text-muted">You’ll continue on The Alternative Bank’s secure account opening page and return here automatically.</p>
        </div>
      )}
      <Why>Murabaha repayments are collected by direct debit from an account held with The Alternative Bank. We only show masked account numbers.</Why>
    </StepCard>
  );
}

export function AccountOpeningPendingStep() {
  const opening = useAccountOpening();
  const { summary } = useCheckout();
  return (
    <StepCard
      eyebrow="Step 2 · Confirm eligibility"
      title="Finish opening your account"
      description="Your account opening has started but isn’t confirmed yet. Continue where you left off — when it’s done you’ll come straight back here."
      footer={
        <Button size="lg" loading={opening.busy === 'open-account'} onClick={() => void opening.start()}>
          Continue account opening
        </Button>
      }
    >
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
        <li>Your financing progress is saved.</li>
        <li>If you’ve just finished, it can take a moment for us to confirm your new account — continuing will check again.</li>
        <li>You can also return later using the checkout link from {summary.partner.name}.</li>
      </ul>
      <ErrorNotice error={opening.error} />
    </StepCard>
  );
}
