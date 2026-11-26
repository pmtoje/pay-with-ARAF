'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Badge, BnplButtonPreview, Button, Checkbox, Field, Input, Select, formatDateTime } from '@araf/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ErrorAlert, Section, useToast } from '@/components/common';

export interface PortalSettings {
  modules: Record<string, boolean>;
  checkout_button: { theme: 'dark' | 'gold'; show_amount: boolean };
  max_users: number;
  support: { email: string | null; phone: string | null };
}
export interface PortalView {
  active: PortalSettings;
  configured: boolean;
  last_approved: { reference: string; decided_at: string } | null;
  pending: { reference: string; settings: PortalSettings; created_at: string } | null;
  modules: Array<{ key: string; label: string; description: string }>;
}

/**
 * The partner side (partners.araf.ng) for one partner. The Super Admin proposes; a Partner
 * Approving Officer approves in the Approvals inbox before anything changes for the partner.
 */
export function PartnerPortalSettings({ partnerId, partnerName, view, onChanged }: { partnerId: string; partnerName: string; view: PortalView; onChanged: () => void }) {
  const { can } = useSession();
  const canEdit = can('partner.portal.configure');
  const base = view.pending?.settings ?? view.active;
  const [s, setS] = useState<PortalSettings>(base);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  useEffect(() => setS(view.pending?.settings ?? view.active), [view]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ approval_reference: string }>(`/api/admin/partners/${partnerId}/portal-settings`, {
        ...s,
        support: { email: s.support.email?.trim() || null, phone: s.support.phone?.trim() || null },
      });
      toast(`Proposed (${r.approval_reference}) — awaiting a Partner Approving Officer`);
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const label = s.checkout_button.show_amount ? 'Buy Now Pay Later with AltBank — ₦645,000' : 'Buy Now Pay Later with AltBank';
  return (
    <Section
      title="Partner portal"
      description={`What ${partnerName}’s team sees on partners.araf.ng. Configured by the Super Admin; takes effect only after a Partner Approving Officer approves.`}
      actions={view.configured ? <Badge tone="success">Configured</Badge> : <Badge>Bank defaults</Badge>}
    >
      <div className="space-y-5">
        {view.pending && (
          <Alert tone="warning" title={`Change ${view.pending.reference} is awaiting approval`}>
            Proposed {formatDateTime(view.pending.created_at)}. The partner keeps the current settings until a Partner Approving Officer approves it in the Approvals inbox.
          </Alert>
        )}
        {!canEdit && <Alert tone="info">Only the Super Administrator can propose partner portal settings.</Alert>}
        <form onSubmit={submit} className="space-y-6" noValidate>
          <fieldset disabled={!canEdit || !!view.pending}>
            <legend className="mb-2 text-sm font-semibold text-fg">Sections available to the partner</legend>
            <p className="mb-3 text-xs text-muted">The dashboard and account security are always available. A section that is off disappears from the partner’s menu and its API calls are refused, whatever the partner user’s role.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {view.modules.map((m) => (
                <div key={m.key} className="rounded-md border border-border p-3">
                  <Checkbox checked={s.modules[m.key]} onChange={(e) => setS({ ...s, modules: { ...s.modules, [m.key]: e.target.checked } })} label={m.label} description={m.description} />
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset disabled={!canEdit || !!view.pending} className="grid gap-5 lg:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-fg">Checkout button on the partner’s website</legend>
            <div className="space-y-3">
              <Field label="Button style">
                {(ids) => (
                  <Select id={ids.id} value={s.checkout_button.theme} onChange={(e) => setS({ ...s, checkout_button: { ...s.checkout_button, theme: e.target.value as 'dark' | 'gold' } })}>
                    <option value="dark">Dark (default)</option>
                    <option value="gold">Gold</option>
                  </Select>
                )}
              </Field>
              <Checkbox checked={s.checkout_button.show_amount} onChange={(e) => setS({ ...s, checkout_button: { ...s.checkout_button, show_amount: e.target.checked } })} label="Show the amount on the button" description="Recommended: the button says what will happen, e.g. “Buy Now Pay Later with AltBank — ₦645,000”." />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Preview</p>
              <BnplButtonPreview label={label} className={s.checkout_button.theme === 'gold' ? '!bg-[#b08a2e]' : ''} />
              <p className="mt-2 text-xs text-muted">The wording “Buy Now Pay Later with AltBank” is fixed by the Bank.</p>
            </div>
          </fieldset>

          <fieldset disabled={!canEdit || !!view.pending} className="grid gap-4 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold text-fg">Team and support</legend>
            <Field label="Maximum portal users" hint="Includes pending invitations.">
              {(ids) => <Input id={ids.id} aria-describedby={ids.describedBy} inputMode="numeric" value={String(s.max_users)} onChange={(e) => setS({ ...s, max_users: Math.max(1, Math.min(500, Number(e.target.value.replace(/\D/g, '')) || 1)) })} />}
            </Field>
            <Field label="Bank support email shown to the partner">
              {(ids) => <Input id={ids.id} type="email" value={s.support.email ?? ''} onChange={(e) => setS({ ...s, support: { ...s.support, email: e.target.value } })} placeholder="partners@araf.ng" />}
            </Field>
            <Field label="Bank support phone">
              {(ids) => <Input id={ids.id} inputMode="tel" value={s.support.phone ?? ''} onChange={(e) => setS({ ...s, support: { ...s.support, phone: e.target.value } })} placeholder="+2348000000000" />}
            </Field>
          </fieldset>

          <div aria-live="assertive">{error ? <ErrorAlert error={error} title="Settings not proposed" /> : null}</div>
          {canEdit && (
            <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-xs text-muted">{view.last_approved ? `Current settings approved ${formatDateTime(view.last_approved.decided_at)} (${view.last_approved.reference}).` : 'The partner currently uses the Bank defaults.'}</p>
              <Button type="submit" loading={busy} disabled={!!view.pending}>
                Propose these settings for approval
              </Button>
            </div>
          )}
        </form>
      </div>
    </Section>
  );
}
