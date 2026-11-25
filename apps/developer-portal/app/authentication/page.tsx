import type { Metadata } from 'next';
import { CodeTabs } from '@/components/code';
import { Callout, DocPage, H2, P, SimpleTable } from '@/components/doc';
import { API_SCOPES } from '@/lib/reference';
import { fetchTabs } from '@/lib/snippets';

export const metadata: Metadata = { title: 'Authentication' };

const SCOPE_ENDPOINTS: Record<string, string> = {
  'checkout:write': 'POST /checkout/sessions',
  'checkout:read': 'GET /checkout/sessions/{id}',
  'applications:read': 'GET /applications/{reference}',
  'orders:read': 'GET /orders/{reference}, GET /releases/{reference}',
  'orders:write': 'POST /orders/{reference}/fulfil, /deliver, /cancel, /return',
  'settlements:read': 'GET /settlements',
  'webhooks:read': 'GET /webhook-events',
  'webhooks:write': 'POST /webhook-events/{id}/retry',
};

export default function Authentication() {
  return (
    <DocPage
      path="/authentication"
      eyebrow="Get started"
      title="Authentication"
      lede="Authenticate every request with a secret key sent as a Bearer token. Keys are scoped, optionally IP-restricted, and can be rotated without downtime."
      toc={['Bearer secret keys', 'Scopes', 'IP allowlists', 'Rotation and revocation', 'Keep keys secret']}
    >
      <H2>Bearer secret keys</H2>
      <P>
        Send your key in the <code>Authorization</code> header. Keys look like <code>sk_test_</code> or <code>sk_live_</code> followed by 40 alphanumeric characters. Missing, malformed, revoked or expired keys return <code>401 INVALID_API_KEY</code>.
      </P>
      <CodeTabs tabs={fetchTabs('GET', '/applications/ARAF-2026-000002')} />
      <P>
        Create keys in <strong>Partner portal → Integration → API keys</strong> (requires the <em>Manage API credentials and webhooks</em> permission). The full secret is shown <strong>once</strong>, at creation; afterwards only its prefix and last four characters are visible.
      </P>

      <H2>Scopes</H2>
      <P>Each key carries one or more scopes. A request outside the key’s scopes fails with <code>403 INSUFFICIENT_SCOPE</code>. Grant each key only what it needs.</P>
      <SimpleTable
        caption="API scopes"
        head={['Scope', 'Allows', 'Endpoints']}
        mono={[0]}
        rows={Object.entries(API_SCOPES).map(([scope, desc]) => [scope, desc, <code key={scope}>{SCOPE_ENDPOINTS[scope]}</code>])}
      />

      <H2>IP allowlists</H2>
      <P>
        Optionally restrict a key to up to 20 IPv4/IPv6 addresses. Requests from other addresses fail with <code>403 IP_NOT_ALLOWED</code>. Use the egress IPs of your production servers; leave the list empty in early sandbox development.
      </P>

      <H2>Rotation and revocation</H2>
      <ul>
        <li>
          <strong>Rotate</strong> issues a new key with the same scopes and IP allowlist. The old key keeps working for <strong>24 hours</strong> and then expires, so you can deploy the new key without downtime.
        </li>
        <li>
          <strong>Revoke</strong> disables a key immediately. Use it if a key may have been exposed.
        </li>
        <li>Keys can be created with an expiry of 1–730 days. Expired keys fail with <code>401 INVALID_API_KEY</code>.</li>
        <li>
          Each key’s <em>last used</em> time is visible in the portal, and every request is listed under <strong>Integration → API requests</strong> with its correlation ID.
        </li>
      </ul>

      <H2>Keep keys secret</H2>
      <Callout tone="danger" title="Never put a secret key in frontend code">
        Secret keys can create checkout sessions and confirm fulfilment for your store. Do not embed them in browser JavaScript, mobile apps, public repositories, logs or support tickets. Store them in a server-side secret manager and load them from environment variables.
      </Callout>
      <P>
        Requests are rate-limited per key (see <a href="/errors#rate-limits">rate limits</a>). The Bank never asks for your secret key; quote the key prefix (e.g. <code>sk_test_Ab12Cd34</code>) and a correlation ID instead.
      </P>
    </DocPage>
  );
}
