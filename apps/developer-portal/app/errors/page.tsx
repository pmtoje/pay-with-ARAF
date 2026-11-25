import type { Metadata } from 'next';
import { CodeBlock } from '@/components/code';
import { Callout, DocPage, H2, H3, P, SimpleTable } from '@/components/doc';
import { json } from '@/lib/examples';
import { ERRORS, type ErrorCode } from '@/lib/reference';

export const metadata: Metadata = { title: 'Errors & idempotency' };

const GROUPS: Array<{ title: string; codes: ErrorCode[]; note?: string }> = [
  { title: 'General', codes: ['VALIDATION_FAILED', 'NOT_FOUND', 'UNAUTHENTICATED', 'FORBIDDEN', 'RATE_LIMITED', 'CONFLICT', 'INVALID_STATE', 'INTERNAL_ERROR', 'INTEGRATION_NOT_CONFIGURED', 'PRECONDITIONS_NOT_MET'] },
  { title: 'Partner API', codes: ['INVALID_API_KEY', 'API_KEY_ENVIRONMENT_MISMATCH', 'INSUFFICIENT_SCOPE', 'IP_NOT_ALLOWED', 'PARTNER_NOT_ACTIVE', 'PRODUCTION_LOCKED', 'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_IN_PROGRESS', 'CART_INVALID', 'RETURN_URL_NOT_APPROVED', 'DUPLICATE_CHECKOUT', 'VENDOR_NOT_ELIGIBLE', 'WEBHOOK_URL_UNSAFE'] },
  { title: 'Orders & fulfilment', codes: ['RELEASE_NOT_AUTHORIZED', 'FULFILMENT_DUPLICATE'] },
];

export default function Errors() {
  const listed = new Set(GROUPS.flatMap((g) => g.codes));
  const others = (Object.keys(ERRORS) as ErrorCode[]).filter((c) => !listed.has(c));
  const row = (c: ErrorCode) => [c, String(ERRORS[c].status), ERRORS[c].message, ERRORS[c].retryable ? 'Yes' : 'No'];
  return (
    <DocPage
      path="/errors"
      eyebrow="Reference"
      title="Errors & idempotency"
      lede="Every error uses one envelope with a stable machine-readable code. Retry only when retryable is true; quote the correlation ID when you contact support."
      toc={['Error envelope', 'Error catalogue', 'Idempotency', 'Rate limits', 'Correlation IDs']}
      wide
    >
      <H2>Error envelope</H2>
      <CodeBlock
        lang="json"
        title="4xx / 5xx"
        code={json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'The request contains invalid or missing fields.',
            retryable: false,
            details: { fields: [{ path: 'items.0.unit_amount', message: 'Expected integer, received float' }] },
            correlation_id: '97ce4e67-ff0c-44e8-ad50-f16dfb99cc9e',
          },
        })}
      />
      <ul>
        <li>
          <code>code</code> — stable identifier; branch on this, not on <code>message</code>.
        </li>
        <li>
          <code>message</code> — safe, human-readable text. Never contains stack traces or internal details.
        </li>
        <li>
          <code>retryable</code> — whether retrying the same request may succeed.
        </li>
        <li>
          <code>details</code> — optional: <code>fields[]</code> for validation errors, <code>errors[]</code> for cart errors, or identifiers such as <code>session_id</code>, <code>application_reference</code>, <code>vendor_reference</code>.
        </li>
        <li>
          <code>correlation_id</code> — also returned in the <code>X-Correlation-Id</code> response header.
        </li>
      </ul>

      <H2>Error catalogue</H2>
      <P>Codes your integration can receive from the partner API:</P>
      {GROUPS.map((g) => (
        <div key={g.title}>
          <H3>{g.title}</H3>
          <SimpleTable caption={`${g.title} errors`} head={['Code', 'HTTP', 'Message', 'Retryable']} rows={g.codes.map(row)} />
        </div>
      ))}
      <details className="my-6 rounded-lg border border-border bg-surface px-4 py-3">
        <summary className="cursor-pointer font-medium text-fg">Customer-journey and portal codes ({others.length})</summary>
        <p className="mt-2 text-sm text-muted">These are returned to the hosted checkout and portals, not to partner API calls. Listed for completeness.</p>
        <SimpleTable caption="Other error codes" head={['Code', 'HTTP', 'Message', 'Retryable']} rows={others.map(row)} />
      </details>

      <H2>Idempotency</H2>
      <P>
        <code>POST /api/v1/checkout/sessions</code> requires an <code>Idempotency-Key</code> header (8–128 characters from <code>A–Z a–z 0–9 _ - : .</code>). Keys are scoped to your partner account and remembered for 24 hours.
      </P>
      <SimpleTable
        caption="Idempotency behaviour"
        mono={[]}
        head={['Situation', 'Result']}
        rows={[
          ['First request with a key', 'Processed normally.'],
          ['Same key, same body, after success', <>The original status and body are replayed, with header <code>Idempotent-Replayed: true</code>.</>],
          ['Same key, different body', <><code>422 IDEMPOTENCY_KEY_REUSED</code></>],
          ['Same key while the first request is still running', <><code>409 IDEMPOTENCY_IN_PROGRESS</code> (retryable — wait and retry)</>],
          ['The first request failed with an error', 'The key is released: retry with the same key.'],
        ]}
      />
      <P>
        Other <code>POST</code> endpoints (fulfil, deliver, cancel, return, retry) are naturally safe to retry: duplicates are rejected with <code>409 FULFILMENT_DUPLICATE</code> or <code>409 INVALID_STATE</code> rather than applied twice.
      </P>
      <Callout tone="info" title="Retry strategy">
        Retry only network errors, timeouts and responses with <code>retryable: true</code> (429, 409 CONFLICT / IDEMPOTENCY_IN_PROGRESS, 5xx), using exponential backoff with jitter. Always reuse the same <code>Idempotency-Key</code> for the same logical request.
      </Callout>

      <H2>Rate limits</H2>
      <P>
        Each API key may make up to <strong>600 requests per 60-second window</strong>. Beyond that the API returns <code>429 RATE_LIMITED</code> until the window resets. Back off and retry; spread polling, and prefer webhooks over polling.
      </P>

      <H2>Correlation IDs</H2>
      <P>
        Every response carries an <code>X-Correlation-Id</code> header. You may send your own <code>X-Correlation-Id</code> (8–64 characters from <code>A–Z a–z 0–9 _ -</code>) to trace a request end to end; otherwise one is generated. The same ID appears in error bodies and in <strong>Partner portal → Integration → API requests</strong>. Include it in every support request.
      </P>
    </DocPage>
  );
}
