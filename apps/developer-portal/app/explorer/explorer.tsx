'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Field, Input, Select, Textarea, cn } from '@araf/ui';
import { CodeBlock } from '@/components/code';
import { CHECKOUT_BODY } from '@/lib/examples';

interface EndpointDef {
  id: string;
  method: 'GET' | 'POST';
  path: string;
  title: string;
  scope: string;
  params: string[];
  query?: Array<{ name: string; hint: string }>;
  body?: () => unknown;
  idempotent?: boolean;
}

const newOrderRef = () => `EXPLORER-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const ENDPOINTS: EndpointDef[] = [
  {
    id: 'create-session',
    method: 'POST',
    path: '/checkout/sessions',
    title: 'Create a checkout session',
    scope: 'checkout:write',
    params: [],
    idempotent: true,
    body: () => {
      const ref = newOrderRef();
      return { ...CHECKOUT_BODY, merchant_order_reference: ref, return_url: `http://localhost:3005/orders/${ref}`, cancel_url: 'http://localhost:3005/cart' };
    },
  },
  { id: 'get-session', method: 'GET', path: '/checkout/sessions/{session_id}', title: 'Retrieve a checkout session', scope: 'checkout:read', params: ['session_id'] },
  { id: 'get-application', method: 'GET', path: '/applications/{reference}', title: 'Retrieve an application', scope: 'applications:read', params: ['reference'] },
  { id: 'get-order', method: 'GET', path: '/orders/{merchant_order_reference}', title: 'Retrieve an order', scope: 'orders:read', params: ['merchant_order_reference'] },
  { id: 'get-release', method: 'GET', path: '/releases/{release_reference}', title: 'Verify a release authorisation', scope: 'orders:read', params: ['release_reference'] },
  { id: 'fulfil', method: 'POST', path: '/orders/{merchant_order_reference}/fulfil', title: 'Record fulfilment', scope: 'orders:write', params: ['merchant_order_reference'], body: () => ({ status: 'DISPATCHED', tracking_reference: 'GIG-123', carrier: 'GIG Logistics' }) },
  { id: 'deliver', method: 'POST', path: '/orders/{merchant_order_reference}/deliver', title: 'Confirm delivery', scope: 'orders:write', params: ['merchant_order_reference'], body: () => ({ note: 'Signed for by customer' }) },
  { id: 'cancel', method: 'POST', path: '/orders/{merchant_order_reference}/cancel', title: 'Cancel an order', scope: 'orders:write', params: ['merchant_order_reference'], body: () => ({ reason: 'Customer changed their mind' }) },
  { id: 'return', method: 'POST', path: '/orders/{merchant_order_reference}/return', title: 'Request a return', scope: 'orders:write', params: ['merchant_order_reference'], body: () => ({ type: 'DAMAGED', reason: 'Screen cracked on arrival' }) },
  { id: 'settlements', method: 'GET', path: '/settlements', title: 'List settlements', scope: 'settlements:read', params: [], query: [{ name: 'status', hint: 'e.g. CONFIRMED' }, { name: 'limit', hint: '1–200' }] },
  { id: 'events', method: 'GET', path: '/webhook-events', title: 'List webhook events', scope: 'webhooks:read', params: [], query: [{ name: 'type', hint: 'e.g. application.created' }, { name: 'limit', hint: '1–200' }] },
  { id: 'retry', method: 'POST', path: '/webhook-events/{event_id}/retry', title: 'Retry a webhook event', scope: 'webhooks:write', params: ['event_id'] },
];

interface Result {
  status: number;
  statusText: string;
  ms: number;
  headers: Array<[string, string]>;
  body: string;
  url: string;
}

const SHOWN_HEADERS = ['content-type', 'x-correlation-id', 'idempotent-replayed', 'cache-control', 'etag', 'date'];

export function Explorer() {
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [endpointId, setEndpointId] = useState(ENDPOINTS[0].id);
  const endpoint = ENDPOINTS.find((e) => e.id === endpointId)!;
  const [params, setParams] = useState<Record<string, string>>({});
  const [query, setQuery] = useState<Record<string, string>>({});
  // Random values are generated after mount so server and client renders match.
  const [body, setBody] = useState('');
  const [idemKey, setIdemKey] = useState('');
  useEffect(() => {
    setBody(JSON.stringify(ENDPOINTS[0].body!(), null, 2));
    setIdemKey(`explorer-${crypto.randomUUID()}`);
  }, []);
  const [correlation, setCorrelation] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remembered, setRemembered] = useState<Record<string, string>>({});
  const resultRef = useRef<HTMLDivElement>(null);

  const keyError = !key ? null : key.startsWith('sk_live_') ? 'Live keys are not accepted here. Use a sandbox key (sk_test_…) — and never paste production secrets into a browser.' : !/^sk_test_[0-9A-Za-z]{40}$/.test(key.trim()) ? 'Expected sk_test_ followed by 40 letters and digits.' : null;
  let bodyError: string | null = null;
  if (endpoint.body && body.trim()) {
    try {
      JSON.parse(body);
    } catch (e) {
      bodyError = `Invalid JSON: ${(e as Error).message}`;
    }
  }
  const missingParam = endpoint.params.find((p) => !(params[p] ?? '').trim());
  const resolvedPath = useMemo(() => {
    let p = endpoint.path;
    for (const name of endpoint.params) p = p.replace(`{${name}}`, encodeURIComponent((params[name] ?? '').trim() || `{${name}}`));
    const q = new URLSearchParams();
    for (const qp of endpoint.query ?? []) if (query[qp.name]?.trim()) q.set(qp.name, query[qp.name].trim());
    const qs = q.toString();
    return `/api/v1${p}${qs ? `?${qs}` : ''}`;
  }, [endpoint, params, query]);

  const choose = (id: string) => {
    const e = ENDPOINTS.find((x) => x.id === id)!;
    setEndpointId(id);
    setBody(e.body ? JSON.stringify(e.body(), null, 2) : '');
    const next: Record<string, string> = {};
    for (const p of e.params) next[p] = params[p] || remembered[p] || '';
    setParams(next);
    setQuery({});
    setResult(null);
    setError(null);
    if (e.idempotent) setIdemKey(`explorer-${crypto.randomUUID()}`);
  };

  const send = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (keyError || !key || bodyError || missingParam) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const headers: Record<string, string> = { Authorization: `Bearer ${key.trim()}`, Accept: 'application/json' };
    if (endpoint.method === 'POST') headers['Content-Type'] = 'application/json';
    if (endpoint.idempotent && idemKey.trim()) headers['Idempotency-Key'] = idemKey.trim();
    if (correlation.trim()) headers['X-Correlation-Id'] = correlation.trim();
    const started = performance.now();
    try {
      const res = await fetch(resolvedPath, {
        method: endpoint.method,
        headers,
        body: endpoint.method === 'POST' ? (body.trim() ? body : '{}') : undefined,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      const text = await res.text();
      let pretty = text;
      try {
        const parsed = JSON.parse(text);
        pretty = JSON.stringify(parsed, null, 2);
        if (res.ok && parsed && typeof parsed === 'object') {
          const r: Record<string, string> = {};
          if (parsed.session_id) r.session_id = parsed.session_id;
          if (parsed.application_reference) r.reference = parsed.application_reference;
          if (parsed.object === 'application' && parsed.reference) r.reference = parsed.reference;
          if (parsed.merchant_order_reference) r.merchant_order_reference = parsed.merchant_order_reference;
          if (parsed.release?.reference) r.release_reference = parsed.release.reference;
          if (endpoint.id === 'create-session') {
            try {
              r.merchant_order_reference = JSON.parse(body).merchant_order_reference;
            } catch {
              /* ignore */
            }
          }
          if (Object.keys(r).length) setRemembered((m) => ({ ...m, ...r }));
        }
      } catch {
        /* not JSON */
      }
      setResult({
        status: res.status,
        statusText: res.statusText,
        ms: Math.round(performance.now() - started),
        headers: [...res.headers.entries()].filter(([k]) => SHOWN_HEADERS.includes(k.toLowerCase())),
        body: pretty,
        url: resolvedPath,
      });
      if (endpoint.idempotent && res.ok) setIdemKey(`explorer-${crypto.randomUUID()}`);
      setTimeout(() => resultRef.current?.focus(), 0);
    } catch (e) {
      setError(`The request could not be sent: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const curl = [
    `curl -X ${endpoint.method} "$ARAF_API_BASE_URL${resolvedPath.replace(/^\/api\/v1/, '')}"`,
    `  -H "Authorization: Bearer $ARAF_SECRET_KEY"`,
    endpoint.idempotent ? `  -H "Idempotency-Key: ${idemKey}"` : null,
    endpoint.method === 'POST' ? `  -H "Content-Type: application/json"` : null,
    endpoint.method === 'POST' && body.trim() ? `  -d '${(() => {
      try {
        return JSON.stringify(JSON.parse(body));
      } catch {
        return body;
      }
    })()}'` : null,
  ]
    .filter(Boolean)
    .join(' \\\n');

  return (
    <div className="space-y-6">
      <Alert tone="danger" title="Sandbox keys only">
        Never paste a production (<code>sk_live_</code>) key into a browser — this page rejects them. Your sandbox key stays in this tab’s memory only: it is not saved, logged or sent anywhere except as the Authorization header of requests you send. Reloading the page forgets it.
      </Alert>

      <form onSubmit={send} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <section className="space-y-4 rounded-lg border border-border bg-surface p-5" aria-labelledby="auth-h">
            <h2 id="auth-h" className="text-base font-semibold text-fg">
              1. Sandbox secret key
            </h2>
            <Field label="Secret key" required hint="From Partner portal → Integration → API keys." error={keyError}>
              {({ id, describedBy, invalid }) => (
                <div className="flex gap-2">
                  <Input
                    id={id}
                    type={showKey ? 'text' : 'password'}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="sk_test_…"
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    className="font-mono text-[13px]"
                    data-1p-ignore
                    data-lpignore="true"
                  />
                  <Button type="button" variant="secondary" className="h-11 shrink-0" onClick={() => setShowKey(!showKey)} aria-pressed={showKey}>
                    {showKey ? 'Hide' : 'Show'}
                  </Button>
                  {key && (
                    <Button type="button" variant="ghost" className="h-11 shrink-0" onClick={() => setKey('')}>
                      Clear
                    </Button>
                  )}
                </div>
              )}
            </Field>
          </section>

          <section className="space-y-4 rounded-lg border border-border bg-surface p-5" aria-labelledby="req-h">
            <h2 id="req-h" className="text-base font-semibold text-fg">
              2. Request
            </h2>
            <Field label="Endpoint">
              {({ id }) => (
                <Select id={id} value={endpointId} onChange={(e) => choose(e.target.value)}>
                  {ENDPOINTS.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.method} {e.path} — {e.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 font-mono text-[13px]">
              <Badge tone={endpoint.method === 'GET' ? 'info' : 'success'}>{endpoint.method}</Badge>
              <span className="break-all text-fg">{resolvedPath}</span>
              <span className="ml-auto text-xs text-muted">
                scope <code>{endpoint.scope}</code>
              </span>
            </div>
            {endpoint.params.map((p) => (
              <Field key={p} label={p} required hint={remembered[p] && params[p] !== remembered[p] ? <button type="button" className="font-medium text-gold-strong underline underline-offset-4" onClick={() => setParams({ ...params, [p]: remembered[p] })}>Use {remembered[p]} from your last response</button> : undefined}>
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} className="font-mono text-[13px]" value={params[p] ?? ''} onChange={(e) => setParams({ ...params, [p]: e.target.value })} spellCheck={false} />}
              </Field>
            ))}
            {endpoint.query?.map((q) => (
              <Field key={q.name} label={`${q.name} (query)`} hint={q.hint}>
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} className="font-mono text-[13px]" value={query[q.name] ?? ''} onChange={(e) => setQuery({ ...query, [q.name]: e.target.value })} />}
              </Field>
            ))}
            {endpoint.idempotent && (
              <Field label="Idempotency-Key" required hint="Reuse a key to see an idempotent replay; a new key is generated after each success.">
                {({ id, describedBy }) => (
                  <div className="flex gap-2">
                    <Input id={id} aria-describedby={describedBy} className="font-mono text-[13px]" value={idemKey} onChange={(e) => setIdemKey(e.target.value)} />
                    <Button type="button" variant="secondary" className="h-11 shrink-0" onClick={() => setIdemKey(`explorer-${crypto.randomUUID()}`)}>
                      New key
                    </Button>
                  </div>
                )}
              </Field>
            )}
            <Field label="X-Correlation-Id" hint="Optional, 8–64 characters [A-Za-z0-9_-].">
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} className="font-mono text-[13px]" value={correlation} onChange={(e) => setCorrelation(e.target.value)} />}
            </Field>
            {endpoint.method === 'POST' && (
              <Field label="JSON body" error={bodyError} hint={endpoint.id === 'create-session' ? 'Amounts in integer kobo. The order reference is randomised so you can create sessions repeatedly.' : undefined}>
                {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} spellCheck={false} className="min-h-[18rem] font-mono text-[12.5px] leading-5" value={body} onChange={(e) => setBody(e.target.value)} />}
              </Field>
            )}
            {endpoint.body && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setBody(JSON.stringify(endpoint.body!(), null, 2))}>
                Reset example body
              </Button>
            )}
          </section>
          <Button type="submit" size="lg" variant="gold" block loading={busy} disabled={!key || !!keyError || !!bodyError || !!missingParam}>
            Send request
          </Button>
          {!key && <p className="text-center text-sm text-muted">Enter a sandbox key to send requests.</p>}
          {key && missingParam && <p className="text-center text-sm text-muted">Fill in {missingParam} to send this request.</p>}
        </div>

        <div className="min-w-0 space-y-5">
          <section aria-labelledby="res-h" aria-live="polite" className="rounded-lg border border-border bg-surface p-5">
            <h2 id="res-h" className="text-base font-semibold text-fg">
              3. Response
            </h2>
            {error && (
              <Alert tone="danger" className="mt-4">
                {error}
              </Alert>
            )}
            {!result && !error && <p className="mt-3 text-sm text-muted">{busy ? 'Sending…' : 'Send a request to see the status, headers and body here.'}</p>}
            {result && (
              <div ref={resultRef} tabIndex={-1} className="mt-4 space-y-4 focus:outline-none">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={cn('rounded-md px-2.5 py-1 font-mono text-sm font-bold', result.status < 300 ? 'bg-success-soft text-success' : result.status < 500 ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger')}>
                    {result.status} {result.statusText}
                  </span>
                  <span className="text-sm text-muted">{result.ms} ms</span>
                </div>
                {result.headers.length > 0 && (
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-md bg-surface-2 px-3 py-2 font-mono text-xs">
                    {result.headers.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted">{k}</dt>
                        <dd className="break-all text-fg">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <CodeBlock lang="json" title="Response body" code={result.body || '(empty)'} maxHeight="32rem" className="!my-0" />
              </div>
            )}
          </section>
          <CodeBlock lang="bash" title="Equivalent cURL (key not included)" code={curl} className="!my-0" />
        </div>
      </form>
    </div>
  );
}
