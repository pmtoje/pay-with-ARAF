'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, EmptyState, Field, Input, Select, Skeleton, cn, formatNaira } from '@araf/ui';
import { VENDORS } from '@/lib/catalogue';
import { NG_STATES } from '@/lib/states';
import { useCart } from '@/components/cart';
import { ProductArt } from '@/components/ProductArt';
import { PayWithArafMark } from '@/components/brand';
import { placeOrder, type PaymentMethod } from '@/app/actions/checkout';
import { arafEligibility } from '../cart/CartView';
import { BNPL_LABEL } from '@/components/ArafEmbed';

type Errors = Partial<Record<'name' | 'phone' | 'address' | 'city' | 'state' | 'method' | 'dob' | 'bvn', string>>;

function validate(v: { name: string; phone: string; address: string; city: string; state: string }, method: PaymentMethod | null): Errors {
  const e: Errors = {};
  if (v.name.trim().length < 2) e.name = 'Enter the recipient’s full name.';
  const digits = v.phone.replace(/[\s()-]/g, '');
  if (!/^(\+?234|0)[789][01]\d{8}$/.test(digits)) e.phone = 'Enter a Nigerian mobile number, e.g. 0803 123 4567.';
  if (v.address.trim().length < 6) e.address = 'Enter a street address (house number and street).';
  if (v.city.trim().length < 2) e.city = 'Enter a town or city.';
  if (!v.state) e.state = 'Choose a state.';
  if (!method) e.method = 'Choose a payment method.';
  return e;
}

function MethodOption({ value, checked, disabled, onSelect, title, children, badge }: { value: PaymentMethod; checked: boolean; disabled?: boolean; onSelect: (v: PaymentMethod) => void; title: ReactNode; children?: ReactNode; badge?: ReactNode }) {
  return (
    <label
      className={cn(
        'flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors focus-within:ring-2 focus-within:ring-focus',
        checked ? 'border-fg bg-surface' : 'border-border bg-surface hover:border-border-strong',
        disabled && 'cursor-not-allowed opacity-60 hover:border-border',
      )}
    >
      <input type="radio" name="method" value={value} checked={checked} disabled={disabled} onChange={() => onSelect(value)} className="mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--color-text))]" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-fg">{title}</span>
          {badge}
        </span>
        {children && <span className="mt-1 block text-sm text-muted">{children}</span>}
      </span>
    </label>
  );
}

export function CheckoutForm({ defaults }: { defaults: { name: string; phone: string } }) {
  const cart = useCart();
  const router = useRouter();
  const [values, setValues] = useState({ name: defaults.name, phone: defaults.phone, address: '', city: '', state: '' });
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [dob, setDob] = useState('');
  const [bvn, setBvn] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [failure, setFailure] = useState<{ title: string; lines: string[]; reference?: string } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const elig = arafEligibility(cart.subtotalKobo, cart.vendors.length);
  useEffect(() => {
    if (method === 'araf' && !elig.ok) setMethod(null);
  }, [elig.ok, method]);

  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => {
    const next = { ...values, [k]: e.target.value };
    setValues(next);
    if (submitted) setErrors(validate(next, method));
  };

  if (!cart.ready) {
    return (
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]" role="status" aria-label="Loading checkout">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (cart.lines.length === 0 && !redirecting) {
    return (
      <div className="mt-8 rounded-lg border border-border bg-surface">
        <EmptyState
          title="Your basket is empty"
          description="Add something to your basket before checking out."
          action={
            <Link href="/" className="btn-mall h-11 text-sm">
              Browse products
            </Link>
          }
        />
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setFailure(null);
    const errs: Errors = validate(values, method);
    // Buy Now Pay Later: AltMall collects the identity details and sends them to the Bank for its checks.
    if (method === 'araf') {
      if (!dob || dob > new Date().toISOString().slice(0, 10)) errs.dob = 'Enter your date of birth.';
      if (!/^\d{11}$/.test(bvn)) errs.bvn = 'Enter the 11 digits of your BVN.';
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setBusy(true);
    try {
      const res = await placeOrder({ lines: cart.lines, delivery: values, method: method!, identity: method === 'araf' ? { date_of_birth: dob || undefined, bvn: bvn || undefined } : undefined });
      if (res.ok) {
        setRedirecting(true);
        cart.clear();
        if (res.external) window.location.assign(res.redirect);
        else router.push(res.redirect);
        return;
      }
      if (res.signInRequired) {
        router.push('/login?next=/checkout');
        return;
      }
      if (res.fields) setErrors(res.fields as Errors);
      if (res.reference) cart.clear();
      setFailure({ title: res.title, lines: res.lines, reference: res.reference });
      requestAnimationFrame(() => errorRef.current?.focus());
    } catch {
      setFailure({ title: 'Something went wrong', lines: ['We couldn’t place your order. Please try again.'] });
    } finally {
      setBusy(false);
    }
  }

  const errorCount = Object.keys(errors).length;

  return (
    <form onSubmit={submit} noValidate className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-8">
        <div ref={errorRef} tabIndex={-1} className="outline-none" aria-live="assertive">
          {failure && (
            <Alert
              tone="danger"
              title={failure.title}
              action={
                failure.reference ? (
                  <Link href={`/orders/${failure.reference}`} className="btn-outline h-10 px-4 text-sm">
                    Go to order
                  </Link>
                ) : undefined
              }
            >
              <ul className="list-disc space-y-0.5 pl-4">
                {failure.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              {failure.reference && <p className="mt-2">Your order {failure.reference} has been saved — you can pay for it another way from the order page.</p>}
            </Alert>
          )}
          {!failure && submitted && errorCount > 0 && <Alert tone="danger" title={`Please fix ${errorCount} ${errorCount === 1 ? 'field' : 'fields'} below`} />}
        </div>

        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-fg">1. Delivery details</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Recipient name" required error={errors.name}>
              {({ id, describedBy, invalid }) => <Input id={id} value={values.name} onChange={set('name')} autoComplete="name" aria-describedby={describedBy} aria-invalid={invalid} required />}
            </Field>
            <Field label="Mobile number" required hint="For delivery updates. Also shared with Pay with ARAF if you choose it." error={errors.phone}>
              {({ id, describedBy, invalid }) => <Input id={id} value={values.phone} onChange={set('phone')} type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" aria-describedby={describedBy} aria-invalid={invalid} required />}
            </Field>
          </div>
          <Field label="Street address" required error={errors.address}>
            {({ id, describedBy, invalid }) => <Input id={id} value={values.address} onChange={set('address')} autoComplete="street-address" placeholder="12 Admiralty Way, Lekki Phase 1" aria-describedby={describedBy} aria-invalid={invalid} required />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Town / city" required error={errors.city}>
              {({ id, describedBy, invalid }) => <Input id={id} value={values.city} onChange={set('city')} autoComplete="address-level2" aria-describedby={describedBy} aria-invalid={invalid} required />}
            </Field>
            <Field label="State" required error={errors.state}>
              {({ id, describedBy, invalid }) => (
                <Select id={id} value={values.state} onChange={set('state')} autoComplete="address-level1" aria-describedby={describedBy} aria-invalid={invalid} required>
                  <option value="">Choose a state</option>
                  {NG_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-3" aria-describedby={errors.method ? 'method-err' : undefined}>
          <legend className="text-lg font-semibold text-fg">2. Payment method</legend>
          {errors.method && (
            <p id="method-err" role="alert" className="text-xs font-medium text-danger">
              {errors.method}
            </p>
          )}
          <MethodOption
            value="araf"
            checked={method === 'araf'}
            disabled={!elig.ok}
            onSelect={(v) => {
              setMethod(v);
              if (submitted) setErrors(validate(values, v));
            }}
            title={<span className="font-semibold text-fg">{BNPL_LABEL}</span>}
            badge={<PayWithArafMark size="sm" />}
          >
            {elig.ok ? (
              <>Spread the cost with non-interest (Murabaha) financing from The Alternative Bank. You stay on AltMall — the Bank’s secure checkout opens right here to check eligibility, subject to approval. AltMall never sees your credit details.</>
            ) : (
              <span className="text-warning">{elig.reasons.join(' ')}</span>
            )}
          </MethodOption>
          {method === 'araf' && (
            <div className="rounded-lg border border-dashed border-border-strong bg-surface-2/40 p-4">
              <p className="text-sm font-semibold text-fg">Details for Buy Now Pay Later</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                AltMall sends these, with your name, phone, email and delivery address, securely to The Alternative Bank, which runs the eligibility checks. They go straight to the Bank — AltMall doesn’t keep your BVN or date of birth. You’ll confirm it’s you with a code sent to your email.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Date of birth" required error={errors.dob}>
                  {({ id, invalid }) => <Input id={id} aria-invalid={invalid} type="date" value={dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDob(e.target.value)} />}
                </Field>
                <Field label="BVN" required hint="11 digits. Dial *565*0# from your registered line if you don’t know it." error={errors.bvn}>
                  {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="password" inputMode="numeric" autoComplete="off" maxLength={11} value={bvn} onChange={(e) => setBvn(e.target.value.replace(/\D/g, '').slice(0, 11))} className="font-mono tracking-widest" />}
                </Field>
              </div>
            </div>
          )}
          <MethodOption
            value="card_demo"
            checked={method === 'card_demo'}
            onSelect={(v) => {
              setMethod(v);
              if (submitted) setErrors(validate(values, v));
            }}
            title="Card (demo)"
            badge={<span className="text-xs text-subtle">Simulated</span>}
          >
            Demo only — no card details are collected. The order is marked as paid immediately.
          </MethodOption>
          <MethodOption
            value="transfer_demo"
            checked={method === 'transfer_demo'}
            onSelect={(v) => {
              setMethod(v);
              if (submitted) setErrors(validate(values, v));
            }}
            title="Bank transfer (demo)"
            badge={<span className="text-xs text-subtle">Simulated</span>}
          >
            Demo only — no transfer is made. The order is marked as paid immediately.
          </MethodOption>
        </fieldset>
      </div>

      <aside className="h-fit space-y-4 lg:sticky lg:top-24" aria-labelledby="sum-h">
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 id="sum-h" className="font-semibold text-fg">
            Order summary
          </h2>
          <ul className="mt-4 space-y-3">
            {cart.detailed.map(({ product, qty, lineKobo }) => (
              <li key={product.sku} className="flex items-center gap-3">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-surface-2 p-1.5" aria-hidden="true">
                  <ProductArt kind={product.art} tone={product.tone} className="h-full w-full" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{product.name}</span>
                  <span className="block text-xs text-muted">
                    Qty {qty} · {VENDORS[product.vendorReference].name}
                  </span>
                </span>
                <span className="text-sm tabular-nums text-fg">{formatNaira(lineKobo)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Delivery</dt>
              <dd className="text-fg">Free</dd>
            </div>
            <div className="flex justify-between text-base">
              <dt className="font-semibold text-fg">Total</dt>
              <dd className="font-semibold tabular-nums text-fg">{formatNaira(cart.subtotalKobo)}</dd>
            </div>
          </dl>
          <Button type="submit" size="lg" block className="mt-5" loading={busy || redirecting}>
            {redirecting ? (method === 'araf' ? 'Opening secure checkout…' : 'Placing order…') : method === 'araf' ? `${BNPL_LABEL} — ${formatNaira(cart.subtotalKobo)}` : method ? `Place order and pay ${formatNaira(cart.subtotalKobo)}` : 'Choose a payment method'}
          </Button>
          <p className="mt-3 text-center text-xs text-subtle">
            <Link href="/cart" className="hover:text-fg">
              Back to basket
            </Link>
          </p>
        </div>
      </aside>
    </form>
  );
}
