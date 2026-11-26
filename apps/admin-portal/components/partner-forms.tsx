'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Badge, Button, Checkbox, DataTable, EmptyState, Field, Input, Select, StatusBadge, Textarea, cn, formatNaira } from '@araf/ui';
import { api } from '@/lib/api';
import { fieldErrors, toInt } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { POLICY_TENORS } from '@/lib/labels';
import { ActionDialog, ErrorAlert, Mono, useToast } from './common';
import { Icon } from './icons';

// ---- Types -----------------------------------------------------------------------------------

export interface PartnerConfig {
  id: string;
  version: number;
  status: string;
  min_transaction_kobo: number;
  max_transaction_kobo: number;
  permitted_products: string[];
  permitted_tenors: number[];
  eligible_categories: string[];
  application_expiry_minutes: number;
  order_reservation_minutes: number;
  partial_financing_enabled: boolean;
  customer_equity_enabled?: boolean;
  /** Product pricing: profit rate per annum (25 = 25% p.a.). */
  annual_profit_rate_percent?: number;
  allow_multiple_vendors: boolean;
  settlement_arrangement: string;
  sandbox_enabled: boolean;
  production_enabled: boolean;
  approved_at: string | null;
  created_at: string;
}

export interface SettlementAccount { id: string; bank_name: string; bank_code: string; account_number_masked: string; account_name: string; verified_name: string | null; verification_status: string; status: string }
export interface Vendor { id: string; vendor_reference: string; name: string; categories: string[]; status: string; is_partner_itself: boolean; settlement_accounts: SettlementAccount[] }

export interface PartnerDetail {
  id: string;
  partner_code: string;
  registered_name: string;
  trading_name: string;
  registration_number: string;
  business_type: string;
  partner_type: 'DIRECT_MERCHANT' | 'MARKETPLACE';
  website_url: string;
  business_address: string;
  business_category: string;
  tax_identification_number: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  technical_contact_name: string | null;
  technical_contact_email: string | null;
  risk_classification: string;
  status: string;
  created_at: string;
  configurations: PartnerConfig[];
  domains: Array<{ id: string; environment: string; kind: string; value: string; approved: boolean }>;
  portal?: import('./partner-portal-settings').PortalView;
  checkout?: { sdk_url: string; api_base_url: string; button_label: string; embed_origins: string[]; pending_origins: string[] };
  vendors: Vendor[];
  status_history: Array<{ from: string | null; to: string; reason: string | null; at: string }>;
  webhook_endpoints: Array<{ id: string; url: string; environment: string; status: string; events: string[]; consecutiveFailures: number; createdAt: string }>;
  credentials: Array<{ id: string; name: string; environment: string; lookupPrefix: string; last4: string; status: string; scopes: string[]; lastUsedAt: string | null; createdAt: string; expiresAt: string | null }>;
  users: Array<{ id: string; email: string; full_name: string; status: string; last_login_at: string | null; roles: string[] }>;
  approvals: Array<{ id: string; reference: string; type: string; status: string; summary: string; created_at: string; decided_at: string | null; checker_comment: string | null }>;
}

// ---- Partner details -----------------------------------------------------------------------

type PartnerInput = Record<string, string>;

const PARTNER_FIELDS: Array<{ key: string; label: string; required?: boolean; type?: string; hint?: string; span?: boolean; autoComplete?: string }> = [
  { key: 'registered_name', label: 'Registered name', required: true },
  { key: 'trading_name', label: 'Trading name', required: true },
  { key: 'registration_number', label: 'CAC registration number', required: true, hint: 'e.g. RC-1234567' },
  { key: 'business_type', label: 'Business type', required: true, hint: 'e.g. Limited liability company' },
  { key: 'business_category', label: 'Business category', required: true, hint: 'e.g. Consumer electronics retail' },
  { key: 'tax_identification_number', label: 'Tax identification number (TIN)' },
  { key: 'website_url', label: 'Website URL', required: true, type: 'url', hint: 'Becomes the partner’s approved website origin.' },
  { key: 'business_address', label: 'Business address', required: true, span: true },
  { key: 'contact_name', label: 'Primary contact name', required: true, autoComplete: 'off' },
  { key: 'contact_email', label: 'Primary contact email', required: true, type: 'email', hint: 'Receives the partner administrator invitation on approval.' },
  { key: 'contact_phone', label: 'Primary contact phone', required: true, type: 'tel', hint: 'International format, e.g. +2348012345678' },
  { key: 'technical_contact_name', label: 'Technical contact name' },
  { key: 'technical_contact_email', label: 'Technical contact email', type: 'email' },
];

export function PartnerDetailsForm({ initial, onSaved, submitLabel, partnerId }: { initial?: Partial<PartnerDetail>; onSaved: (r: { id: string }) => void; submitLabel: string; partnerId?: string }) {
  const [v, setV] = useState<PartnerInput>(() => {
    const o: PartnerInput = { partner_type: initial?.partner_type ?? 'MARKETPLACE', risk_classification: initial?.risk_classification ?? 'UNCLASSIFIED' };
    for (const f of PARTNER_FIELDS) o[f.key] = String((initial as Record<string, unknown> | undefined)?.[f.key] ?? '');
    return o;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const errs = fieldErrors(error);
  const toast = useToast();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) if (val.trim() !== '') body[k] = val.trim();
    try {
      if (partnerId) {
        await api.post(`/api/admin/partners/${partnerId}`, body);
        toast('Partner details saved');
        onSaved({ id: partnerId });
      } else {
        const r = await api.post<{ id: string; partner_code: string }>('/api/admin/partners', body);
        toast(`Partner ${r.partner_code} created as a draft`);
        onSaved(r);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Partner type" required hint={v.partner_type === 'DIRECT_MERCHANT' ? 'The merchant is its own vendor and settlement beneficiary.' : 'A marketplace onboards multiple third-party vendors.'}>
          {(ids) => (
            <Select id={ids.id} aria-describedby={ids.describedBy} value={v.partner_type} onChange={(e) => setV({ ...v, partner_type: e.target.value })} disabled={!!partnerId}>
              <option value="MARKETPLACE">Marketplace</option>
              <option value="DIRECT_MERCHANT">Direct merchant</option>
            </Select>
          )}
        </Field>
        <Field label="Risk classification" required>
          {(ids) => (
            <Select id={ids.id} value={v.risk_classification} onChange={(e) => setV({ ...v, risk_classification: e.target.value })}>
              {['UNCLASSIFIED', 'LOW', 'MEDIUM', 'HIGH'].map((r) => <option key={r} value={r}>{r[0] + r.slice(1).toLowerCase()}</option>)}
            </Select>
          )}
        </Field>
        {PARTNER_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} required={f.required} hint={f.hint} error={errs[f.key]} className={f.span ? 'sm:col-span-2' : undefined}>
            {(ids) => <Input id={ids.id} type={f.type ?? 'text'} autoComplete={f.autoComplete ?? 'off'} aria-describedby={ids.describedBy} aria-invalid={ids.invalid} value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />}
          </Field>
        ))}
      </div>
      <div aria-live="assertive">{error ? <ErrorAlert error={error} title="Partner details not saved" /> : null}</div>
      <div className="flex justify-end"><Button type="submit" loading={busy}>{submitLabel}</Button></div>
    </form>
  );
}

// ---- Configuration ----------------------------------------------------------------------

function TagInput({ id, value, onChange, describedBy, placeholder }: { id: string; value: string[]; onChange: (v: string[]) => void; describedBy?: string; placeholder?: string }) {
  const [text, setText] = useState('');
  const add = () => {
    const parts = text.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setText('');
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input id={id} aria-describedby={describedBy} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }} />
        <Button variant="secondary" onClick={add} disabled={!text.trim()}>Add</Button>
      </div>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected">
          {value.map((t) => (
            <li key={t} className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface-2 py-0.5 pl-2 pr-1 text-xs">
              {t}
              <button type="button" aria-label={`Remove ${t}`} className="rounded p-0.5 text-subtle hover:bg-surface hover:text-fg" onClick={() => onChange(value.filter((x) => x !== t))}>{Icon.x('h-3 w-3')}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ConfigForm({ partnerId, base, domains, partnerStatus, onSaved, onCancel }: { partnerId: string; base?: PartnerConfig; domains?: PartnerDetail['domains']; partnerStatus: string; onSaved: (c: PartnerConfig) => void; onCancel?: () => void }) {
  const [min, setMin] = useState(base ? String(base.min_transaction_kobo / 100) : '20000');
  const [max, setMax] = useState(base ? String(base.max_transaction_kobo / 100) : '5000000');
  const [tenors, setTenors] = useState<number[]>(base?.permitted_tenors ?? [3, 6, 12]);
  const [cats, setCats] = useState<string[]>(base?.eligible_categories ?? []);
  const [expiry, setExpiry] = useState(String(base?.application_expiry_minutes ?? 1440));
  const [reservation, setReservation] = useState(String(base?.order_reservation_minutes ?? 4320));
  const [multi, setMulti] = useState(base?.allow_multiple_vendors ?? false);
  const [equity, setEquity] = useState(base?.partial_financing_enabled ?? true);
  const [rate, setRate] = useState(String(base?.annual_profit_rate_percent ?? 25));
  const [settlement, setSettlement] = useState(base?.settlement_arrangement ?? 'DIRECT_TO_VENDOR');
  const [origins, setOrigins] = useState((domains ?? []).filter((d) => d.kind === 'RETURN_URL_ORIGIN').map((d) => d.value).join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const errs = fieldErrors(error);
  const live = !['DRAFT', 'ADDITIONAL_INFORMATION_REQUIRED', 'SUBMITTED', 'UNDER_REVIEW'].includes(partnerStatus);
  const local: Record<string, string> = {};
  const minN = toInt(min);
  const maxN = toInt(max);
  if (!minN || minN <= 0) local.min_transaction_naira = 'Enter a positive whole naira amount.';
  if (!maxN || maxN <= 0) local.max_transaction_naira = 'Enter a positive whole naira amount.';
  else if (minN && maxN < minN) local.max_transaction_naira = 'Maximum must be at least the minimum.';
  if (!tenors.length) local.permitted_tenors = 'Select at least one tenor.';
  const rateN = /^\d{1,3}(\.\d{1,2})?$/.test(rate.trim()) ? Number(rate.trim()) : NaN;
  if (!(rateN >= 0 && rateN <= 100)) local.annual_profit_rate_percent = 'Enter a rate between 0 and 100, with up to 2 decimals.';
  if (!cats.length) local.eligible_categories = 'Add at least one category.';
  const originList = origins.split(/[\s,]+/).map((o) => o.trim()).filter(Boolean);
  if (!originList.length) local.return_url_origins = 'Add at least one return URL origin.';
  const [touched, setTouched] = useState(false);
  const show = (k: string) => errs[k] ?? (touched ? local[k] : undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(local).length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<PartnerConfig>(`/api/admin/partners/${partnerId}/configuration`, {
        min_transaction_naira: minN,
        max_transaction_naira: maxN,
        permitted_products: ['MURABAHA_ASSET_FINANCING'],
        permitted_tenors: [...tenors].sort((a, b) => a - b),
        eligible_categories: cats,
        application_expiry_minutes: toInt(expiry) ?? 0,
        order_reservation_minutes: toInt(reservation) ?? 0,
        partial_financing_enabled: equity,
        annual_profit_rate_percent: rateN,
        allow_multiple_vendors: multi,
        settlement_arrangement: settlement,
        return_url_origins: originList,
      });
      toast(live ? `Configuration v${r.version} proposed — awaiting checker approval` : `Configuration v${r.version} saved as proposed`);
      onSaved(r);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {live && <Alert tone="info" title="Maker–checker change">This partner is live. Your configuration is created as a new version and only becomes active when a Partner Approving Officer approves it.</Alert>}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-fg">Transaction limits</legend>
        <Field label="Minimum transaction (₦)" required error={show('min_transaction_naira')} hint={minN ? formatNaira(minN * 100, { noKobo: true }) : undefined}>
          {(ids) => <Input id={ids.id} inputMode="numeric" aria-describedby={ids.describedBy} aria-invalid={ids.invalid} value={min} onChange={(e) => setMin(e.target.value)} />}
        </Field>
        <Field label="Maximum transaction (₦)" required error={show('max_transaction_naira')} hint={maxN ? formatNaira(maxN * 100, { noKobo: true }) : undefined}>
          {(ids) => <Input id={ids.id} inputMode="numeric" aria-describedby={ids.describedBy} aria-invalid={ids.invalid} value={max} onChange={(e) => setMax(e.target.value)} />}
        </Field>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-fg">Product, pricing & tenors</legend>
        <p className="mt-0.5 text-xs text-muted">Only tenors approved by the active credit policy can be offered (maximum 24 months): {POLICY_TENORS.join(', ')} months.</p>
        <div className="mt-3"><Checkbox checked readOnly disabled label="Murabaha asset financing" description="The only permitted product in this build." /></div>
        <Field className="mt-3 max-w-xs" label="Profit rate (% per annum)" required error={show('annual_profit_rate_percent')} hint={Number.isFinite(rateN) ? `12 months = ${rateN}% total markup; 24 months = ${Math.round(rateN * 200) / 100}%. Applied to the financed amount only.` : undefined}>
          {(ids) => <Input id={ids.id} inputMode="decimal" aria-describedby={ids.describedBy} aria-invalid={ids.invalid} value={rate} onChange={(e) => setRate(e.target.value)} />}
        </Field>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Permitted tenors">
          {POLICY_TENORS.map((t) => {
            const on = tenors.includes(t);
            return (
              <button key={t} type="button" aria-pressed={on} onClick={() => setTenors(on ? tenors.filter((x) => x !== t) : [...tenors, t])} className={cn('h-10 min-w-[4.5rem] rounded-md border px-3 text-sm font-medium tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', on ? 'border-gold bg-gold-soft text-gold-strong' : 'border-border-strong text-muted hover:text-fg')}>
                {t} months
              </button>
            );
          })}
        </div>
        {show('permitted_tenors') && <p className="mt-1.5 text-xs font-medium text-danger" role="alert">{show('permitted_tenors')}</p>}
      </fieldset>

      <Field label="Eligible product categories" required error={show('eligible_categories')} hint="Lower-case category codes as sent in the partner’s cart items (e.g. smartphones, laptops). Press Enter to add.">
        {(ids) => <TagInput id={ids.id} describedBy={ids.describedBy} value={cats} onChange={setCats} placeholder="e.g. smartphones" />}
      </Field>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-fg">Validity windows</legend>
        <Field label="Application expiry (minutes)" required error={show('application_expiry_minutes')} hint="30 minutes to 30 days. 1440 = 24 hours.">
          {(ids) => <Input id={ids.id} inputMode="numeric" aria-describedby={ids.describedBy} value={expiry} onChange={(e) => setExpiry(e.target.value)} />}
        </Field>
        <Field label="Order reservation (minutes)" required error={show('order_reservation_minutes')} hint="How long the merchant holds stock. 4320 = 3 days.">
          {(ids) => <Input id={ids.id} inputMode="numeric" aria-describedby={ids.describedBy} value={reservation} onChange={(e) => setReservation(e.target.value)} />}
        </Field>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold text-fg">Settlement & financing options</legend>
        <Field label="Settlement arrangement" required>
          {(ids) => (
            <Select id={ids.id} value={settlement} onChange={(e) => setSettlement(e.target.value)}>
              <option value="DIRECT_TO_VENDOR">Direct to vendor — the Bank pays each vendor’s approved account</option>
              <option value="TO_MARKETPLACE">To marketplace — the Bank pays the marketplace’s approved account</option>
            </Select>
          )}
        </Field>
        <Checkbox checked={multi} onChange={(e) => setMulti(e.target.checked)} label="Allow multiple vendors per order" />
        <div>
          <Checkbox checked={equity} onChange={(e) => setEquity(e.target.checked)} label="Customer equity (down payment)" description="Customers may pay part of the price to the partner; the Bank finances only the remainder and charges profit on the financed amount. The partner confirms receipt before the Bank pays the vendor." />
        </div>
      </fieldset>

      <Field label="Return URL origins" required error={show('return_url_origins')} hint="One origin per line (scheme + host), e.g. https://shop.example.com. Customers are only returned to approved origins.">
        {(ids) => <Textarea id={ids.id} aria-describedby={ids.describedBy} aria-invalid={ids.invalid} value={origins} onChange={(e) => setOrigins(e.target.value)} className="font-mono text-sm" />}
      </Field>

      <div aria-live="assertive">{error ? <ErrorAlert error={error} title="Configuration not saved" /> : null}</div>
      <div className="flex justify-end gap-2">
        {onCancel && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" loading={busy}>{live ? 'Propose configuration' : 'Save configuration'}</Button>
      </div>
    </form>
  );
}

export function ConfigSummary({ c }: { c: PartnerConfig }) {
  const row = (label: string, value: ReactNode) => (
    <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-fg">{value}</dd>
    </div>
  );
  return (
    <dl>
      {row('Transaction limits', `${formatNaira(c.min_transaction_kobo, { noKobo: true })} – ${formatNaira(c.max_transaction_kobo, { noKobo: true })}`)}
      {row('Tenors', c.permitted_tenors.map((t) => `${t}m`).join(' · '))}
      {row('Categories', <span className="inline-flex flex-wrap justify-end gap-1">{c.eligible_categories.map((x) => <Badge key={x}>{x}</Badge>)}</span>)}
      {row('Application expiry', `${c.application_expiry_minutes.toLocaleString()} min`)}
      {row('Order reservation', `${c.order_reservation_minutes.toLocaleString()} min`)}
      {row('Settlement', c.settlement_arrangement === 'DIRECT_TO_VENDOR' ? 'Direct to vendor' : 'To marketplace')}
      {row('Multiple vendors', c.allow_multiple_vendors ? 'Allowed' : 'Not allowed')}
      {row('Profit rate', c.annual_profit_rate_percent !== undefined ? `${c.annual_profit_rate_percent}% per annum` : '—')}
      {row('Customer equity', c.partial_financing_enabled ? 'Enabled — financed = price − equity' : 'Disabled')}
      {row('Environments', <span className="inline-flex gap-1"><Badge tone={c.sandbox_enabled ? 'success' : 'neutral'}>Sandbox {c.sandbox_enabled ? 'on' : 'off'}</Badge><Badge tone={c.production_enabled ? 'success' : 'neutral'}>Production {c.production_enabled ? 'on' : 'off'}</Badge></span>)}
    </dl>
  );
}

// ---- Vendors & settlement accounts ---------------------------------------------------

export function VendorManager({ partner, onChanged }: { partner: Pick<PartnerDetail, 'id' | 'vendors' | 'partner_type'>; onChanged: () => void }) {
  const { can } = useSession();
  const manage = can('vendor.manage');
  const [addVendor, setAddVendor] = useState(false);
  const [accountFor, setAccountFor] = useState<Vendor | null>(null);
  const [result, setResult] = useState<{ vendor: string; verification_status: string; verified_name: string | null } | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Vendor payments are made only to a settlement account that passed name enquiry and was approved by a second officer (<Mono>vendor.approve</Mono>).
        </p>
        {manage && <Button size="sm" onClick={() => setAddVendor(true)}>{Icon.plus()} Add vendor</Button>}
      </div>
      {result && (
        <Alert
          tone={result.verification_status === 'VERIFIED' ? 'success' : 'danger'}
          title={result.verification_status === 'VERIFIED' ? `Name enquiry verified — ${result.verified_name}` : 'Name enquiry did not verify the account'}
          action={<Button size="sm" variant="ghost" onClick={() => setResult(null)}>Dismiss</Button>}
        >
          {result.verification_status === 'VERIFIED'
            ? `The account for ${result.vendor} was sent to the Approvals inbox. It cannot receive payments until a checker approves it.`
            : `The account for ${result.vendor} was recorded as MISMATCH and was not submitted for approval. Check the account number and name with the vendor.`}
        </Alert>
      )}
      {partner.vendors.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong"><EmptyState title="No vendors yet" description={partner.partner_type === 'MARKETPLACE' ? 'Add the marketplace’s vendors and their settlement accounts.' : 'The partner’s own vendor record is created automatically.'} /></div>
      ) : (
        partner.vendors.map((v) => (
          <div key={v.id} className="rounded-lg border border-border">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {v.name}
                  <StatusBadge status={v.status} />
                  {v.is_partner_itself && <Badge tone="info">Partner itself</Badge>}
                </p>
                <p className="mt-0.5 text-xs text-muted"><Mono>{v.vendor_reference}</Mono>{v.categories.length ? ` · ${v.categories.join(', ')}` : ''}</p>
              </div>
              {manage && <Button size="sm" variant="secondary" onClick={() => setAccountFor(v)}>{Icon.plus()} Settlement account</Button>}
            </div>
            <DataTable
              caption={`Settlement accounts for ${v.name}`}
              rows={v.settlement_accounts}
              rowKey={(a) => a.id}
              dense
              empty={<p className="px-4 py-4 text-sm text-muted">No settlement account yet — payments to this vendor are blocked.</p>}
              columns={[
                { key: 'bank', header: 'Bank', cell: (a) => <span>{a.bank_name} <span className="text-subtle">({a.bank_code})</span></span> },
                { key: 'acct', header: 'Account', cell: (a) => <Mono>{a.account_number_masked}</Mono> },
                { key: 'name', header: 'Account name', cell: (a) => a.account_name },
                { key: 'ne', header: 'Name enquiry', cell: (a) => <span className="flex flex-col"><StatusBadge status={a.verification_status} />{a.verified_name && <span className="mt-0.5 text-2xs text-muted">{a.verified_name}</span>}</span> },
                { key: 'st', header: 'Approval', cell: (a) => <StatusBadge status={a.status} label={a.status === 'PENDING_APPROVAL' ? 'Awaiting checker' : undefined} /> },
              ]}
            />
          </div>
        ))
      )}
      <AddVendorDialog open={addVendor} partnerId={partner.id} onClose={() => setAddVendor(false)} onDone={onChanged} />
      <AddAccountDialog vendor={accountFor} partnerId={partner.id} onClose={() => setAccountFor(null)} onDone={(r) => { setResult(r); onChanged(); }} />
    </div>
  );
}

function AddVendorDialog({ open, partnerId, onClose, onDone }: { open: boolean; partnerId: string; onClose: () => void; onDone: () => void }) {
  const [ref, setRef] = useState('');
  const [name, setName] = useState('');
  const [reg, setReg] = useState('');
  const [cats, setCats] = useState('');
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title="Add vendor"
      description="Vendors supply goods sold through the partner. Each needs an approved settlement account before it can be paid."
      confirmLabel="Add vendor"
      validate={() => (!/^[A-Za-z0-9._-]{1,64}$/.test(ref) ? 'Vendor reference: letters, numbers, dot, dash or underscore (max 64).' : !name.trim() ? 'Vendor name is required.' : !cats.trim() ? 'Add at least one category.' : null)}
      onConfirm={() => api.post(`/api/admin/partners/${partnerId}/vendors`, { vendor_reference: ref.trim(), name: name.trim(), registration_number: reg.trim() || undefined, categories: cats.split(',').map((c) => c.trim()).filter(Boolean) })}
      successMessage="Vendor added"
      onDone={() => { setRef(''); setName(''); setReg(''); setCats(''); onDone(); }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Vendor reference" required hint="The partner’s identifier, used in cart items.">
          {(ids) => <Input id={ids.id} aria-describedby={ids.describedBy} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="VENDOR-LAGOS-01" />}
        </Field>
        <Field label="Vendor name" required>{(ids) => <Input id={ids.id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Registration number">{(ids) => <Input id={ids.id} value={reg} onChange={(e) => setReg(e.target.value)} />}</Field>
        <Field label="Categories" required hint="Comma separated, e.g. laptops, smartphones">
          {(ids) => <Input id={ids.id} aria-describedby={ids.describedBy} value={cats} onChange={(e) => setCats(e.target.value)} />}
        </Field>
      </div>
    </ActionDialog>
  );
}

function AddAccountDialog({ vendor, partnerId, onClose, onDone }: { vendor: Vendor | null; partnerId: string; onClose: () => void; onDone: (r: { vendor: string; verification_status: string; verified_name: string | null }) => void }) {
  const [code, setCode] = useState('');
  const [bank, setBank] = useState('');
  const [acct, setAcct] = useState('');
  const [name, setName] = useState('');
  return (
    <ActionDialog
      open={!!vendor}
      onClose={onClose}
      title={`Add settlement account${vendor ? ` — ${vendor.name}` : ''}`}
      description="A name enquiry runs immediately. Verified accounts are sent to the Approvals inbox; mismatches are recorded and not submitted."
      confirmLabel="Verify and submit"
      validate={() => (!/^\d{3,6}$/.test(code) ? 'Bank code must be 3–6 digits.' : !bank.trim() ? 'Bank name is required.' : !/^\d{10}$/.test(acct) ? 'Account number must be exactly 10 digits (NUBAN).' : !name.trim() ? 'Account name is required.' : null)}
      onConfirm={() => api.post<{ id: string; verification_status: string; verified_name: string | null }>(`/api/admin/partners/${partnerId}/vendors/${vendor!.id}/settlement-accounts`, { bank_code: code, bank_name: bank.trim(), account_number: acct, account_name: name.trim() })}
      successMessage={(r) => (r.verification_status === 'VERIFIED' ? 'Account verified and sent for approval' : 'Account recorded — name enquiry mismatch')}
      onDone={(r) => { onDone({ vendor: vendor?.name ?? '', verification_status: r.verification_status, verified_name: r.verified_name }); setCode(''); setBank(''); setAcct(''); setName(''); }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bank code" required hint="CBN bank code, e.g. 058">{(ids) => <Input id={ids.id} inputMode="numeric" aria-describedby={ids.describedBy} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />}</Field>
        <Field label="Bank name" required>{(ids) => <Input id={ids.id} value={bank} onChange={(e) => setBank(e.target.value)} />}</Field>
        <Field label="Account number" required hint="10-digit NUBAN. Stored encrypted; only the last 4 digits are shown.">{(ids) => <Input id={ids.id} inputMode="numeric" autoComplete="off" aria-describedby={ids.describedBy} value={acct} onChange={(e) => setAcct(e.target.value.replace(/\D/g, '').slice(0, 10))} />}</Field>
        <Field label="Account name" required hint="As provided by the vendor.">{(ids) => <Input id={ids.id} aria-describedby={ids.describedBy} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      </div>
    </ActionDialog>
  );
}
