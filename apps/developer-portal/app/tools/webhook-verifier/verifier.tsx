'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Field, Input, Textarea, cn } from '@araf/ui';
import { exampleEvent } from '@/lib/examples';

const TOLERANCE = 300;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** Constant-time comparison of two equal-length hex strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseHeader(header: string): { t: number | null; v1: string[]; ignored: string[] } {
  let t: number | null = null;
  const v1: string[] = [];
  const ignored: string[] = [];
  for (const part of header.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const i = trimmed.indexOf('=');
    const k = i >= 0 ? trimmed.slice(0, i) : trimmed;
    const v = i >= 0 ? trimmed.slice(i + 1) : '';
    if (k === 't' && /^\d+$/.test(v)) t = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/.test(v)) v1.push(v);
    else ignored.push(trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed);
  }
  return { t, v1, ignored };
}

interface Outcome {
  verdict: 'VALID' | 'MALFORMED' | 'TIMESTAMP' | 'MISMATCH';
  t: number | null;
  ageSeconds: number | null;
  expected: string | null;
  matchedIndex: number;
  signatureMatches: boolean;
  v1Count: number;
  ignored: string[];
}

function formatAge(s: number): string {
  const abs = Math.abs(s);
  const txt = abs < 120 ? `${abs} s` : abs < 7200 ? `${Math.round(abs / 60)} min` : abs < 172800 ? `${Math.round(abs / 3600)} h` : `${Math.round(abs / 86400)} days`;
  return s >= 0 ? `${txt} ago` : `${txt} in the future`;
}

export function Verifier() {
  const [body, setBody] = useState('');
  const [header, setHeader] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);
  useEffect(() => setSupported(typeof crypto !== 'undefined' && !!crypto.subtle), []);

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setOutcome(null);
    if (!crypto?.subtle) {
      setError('WebCrypto is unavailable. Open this page over HTTPS or on localhost.');
      return;
    }
    setBusy(true);
    try {
      const parsed = parseHeader(header.replace(/^ARAF-Signature:\s*/i, ''));
      const now = Math.floor(Date.now() / 1000);
      if (parsed.t === null || parsed.v1.length === 0) {
        setOutcome({ verdict: 'MALFORMED', t: parsed.t, ageSeconds: parsed.t === null ? null : now - parsed.t, expected: null, matchedIndex: -1, signatureMatches: false, v1Count: parsed.v1.length, ignored: parsed.ignored });
        return;
      }
      const expected = await hmacHex(secret, `${parsed.t}.${body}`);
      const matchedIndex = parsed.v1.findIndex((s) => safeEqual(s, expected));
      const age = now - parsed.t;
      const signatureMatches = matchedIndex >= 0;
      const verdict = Math.abs(age) > TOLERANCE ? 'TIMESTAMP' : signatureMatches ? 'VALID' : 'MISMATCH';
      setOutcome({ verdict, t: parsed.t, ageSeconds: age, expected, matchedIndex, signatureMatches, v1Count: parsed.v1.length, ignored: parsed.ignored });
    } catch (err) {
      setError(`Verification failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const loadSample = async () => {
    const sampleSecret = `whsec_SAMPLEonlyNotARealSecret${Math.random().toString(36).slice(2, 10)}`;
    const sampleBody = JSON.stringify(exampleEvent('goods.release_authorized', { test: true }));
    const t = Math.floor(Date.now() / 1000);
    setBody(sampleBody);
    setSecret(sampleSecret);
    setHeader(`t=${t},v1=${await hmacHex(sampleSecret, `${t}.${sampleBody}`)}`);
    setOutcome(null);
  };

  const tone = outcome?.verdict === 'VALID' ? 'success' : outcome ? 'danger' : 'info';
  const headline = {
    VALID: 'Valid signature',
    MALFORMED: 'Malformed ARAF-Signature header',
    TIMESTAMP: 'Rejected: timestamp outside the 300-second tolerance',
    MISMATCH: 'Invalid signature',
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <form onSubmit={verify} className="space-y-5 rounded-lg border border-border bg-surface p-5">
        <Alert tone="success" title="Runs entirely in your browser">
          Verification uses WebCrypto (HMAC-SHA256) on this device. Nothing you paste is sent to any server or stored. Prefer a sandbox secret; rotate any production secret you have pasted anywhere outside your servers.
        </Alert>
        {!supported && <Alert tone="danger">WebCrypto is not available in this context. Use HTTPS or localhost.</Alert>}
        <Field label="Raw request body" required hint="Paste the exact bytes received — not re-formatted JSON.">
          {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} spellCheck={false} style={{ minHeight: "12rem" }} className="font-mono text-[12.5px] leading-5" value={body} onChange={(e) => setBody(e.target.value)} placeholder='{"event_id":"evt_…","event":"goods.release_authorized",…}' />}
        </Field>
        <Field label="ARAF-Signature header" required hint="e.g. t=1795600502,v1=5f1c…">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} spellCheck={false} autoComplete="off" className="font-mono text-[13px]" value={header} onChange={(e) => setHeader(e.target.value)} placeholder="t=…,v1=…" />}
        </Field>
        <Field label="Endpoint signing secret" required hint="The full whsec_… value from Partner portal → Integration → Webhooks.">
          {({ id, describedBy }) => (
            <div className="flex gap-2">
              <Input id={id} aria-describedby={describedBy} type={showSecret ? 'text' : 'password'} autoComplete="off" spellCheck={false} className="font-mono text-[13px]" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="whsec_…" data-1p-ignore data-lpignore="true" />
              <Button type="button" variant="secondary" className="h-11 shrink-0" onClick={() => setShowSecret(!showSecret)} aria-pressed={showSecret}>
                {showSecret ? 'Hide' : 'Show'}
              </Button>
            </div>
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="gold" loading={busy} disabled={!body || !header || !secret}>
            Verify signature
          </Button>
          <Button type="button" variant="secondary" onClick={loadSample}>
            Load a signed sample
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setBody('');
              setHeader('');
              setSecret('');
              setOutcome(null);
              setError(null);
            }}
          >
            Clear
          </Button>
        </div>
      </form>

      <section aria-labelledby="result-h" aria-live="polite" className="space-y-4">
        <h2 id="result-h" className="sr-only">
          Result
        </h2>
        {error && <Alert tone="danger">{error}</Alert>}
        {!outcome && !error && (
          <div className="rounded-lg border border-dashed border-border-strong px-5 py-10 text-center text-sm text-muted">Paste a delivery’s body, header and secret, then select “Verify signature”. Or load a signed sample to see how it works.</div>
        )}
        {outcome && (
          <div className={cn('rounded-lg border-2 px-5 py-5', tone === 'success' ? 'border-success bg-success-soft' : 'border-danger bg-danger-soft')} data-testid="verifier-result">
            <p className={cn('text-lg font-bold', tone === 'success' ? 'text-success' : 'text-danger')}>{headline[outcome.verdict]}</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-subtle">Timestamp (t)</dt>
                <dd className="mt-0.5 text-fg">
                  {outcome.t === null ? (
                    'Missing or not an integer'
                  ) : (
                    <>
                      <span className="font-mono">{outcome.t}</span> · {new Date(outcome.t * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC ·{' '}
                      <strong className={Math.abs(outcome.ageSeconds ?? 0) > TOLERANCE ? 'text-danger' : 'text-success'}>{formatAge(outcome.ageSeconds ?? 0)}</strong>
                      <span className="text-muted"> (tolerance ±{TOLERANCE} s)</span>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-subtle">Signatures in header</dt>
                <dd className="mt-0.5 text-fg">
                  {outcome.v1Count} valid-looking <code className="font-mono">v1</code> value{outcome.v1Count === 1 ? '' : 's'}
                  {outcome.v1Count > 1 && ' (secret rotation in progress)'}
                  {outcome.ignored.length > 0 && <span className="block text-xs text-muted">Ignored parts: {outcome.ignored.join(', ')}</span>}
                </dd>
              </div>
              {outcome.expected && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-subtle">HMAC match</dt>
                  <dd className="mt-0.5 text-fg">{outcome.signatureMatches ? `Matches v1 #${outcome.matchedIndex + 1}` : 'No v1 value matches the HMAC of this body with this secret.'}</dd>
                </div>
              )}
              {outcome.expected && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-subtle">Computed signature</dt>
                  <dd className="mt-0.5 break-all font-mono text-xs text-fg">{outcome.expected}</dd>
                </div>
              )}
            </dl>
            {outcome.verdict === 'MISMATCH' && (
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-fg/90">
                <li>Is the body byte-for-byte what was received (no re-formatting, trailing newline or changed escapes)?</li>
                <li>Is this the secret of the endpoint that received the delivery (including the whsec_ prefix)?</li>
                <li>If the secret was rotated, the header carries one v1 per active secret — any match is valid.</li>
              </ul>
            )}
            {outcome.verdict === 'TIMESTAMP' && outcome.signatureMatches && <p className="mt-4 text-sm text-fg/90">The HMAC matches, but a receiver must reject deliveries older than 5 minutes to prevent replays. Old deliveries can be re-sent from the Event log.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
