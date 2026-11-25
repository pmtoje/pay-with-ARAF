import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeBlock, CodeTabs } from '@/components/code';
import { Callout, DocPage, H2, P, Steps } from '@/components/doc';
import { VERIFY_TABS } from '@/lib/snippets';

export const metadata: Metadata = { title: 'Verifying signatures' };

export default function Signatures() {
  return (
    <DocPage
      path="/webhooks/signatures"
      eyebrow="Webhooks"
      title="Verifying signatures"
      lede="Every webhook is signed with your endpoint’s secret using HMAC-SHA256. Verify each request before acting on it."
      toc={['Signature scheme', 'Verification steps', 'Examples', 'Secret rotation', 'Common mistakes']}
    >
      <H2>Signature scheme</H2>
      <CodeBlock
        lang="text"
        title="Headers"
        code={`ARAF-Signature: t=1795600502,v1=5f1c0e2b…9a4d
ARAF-Timestamp: 1795600502
ARAF-Event-Id:  evt_95L9ZTu48WZumW0FUOMXD8mI`}
      />
      <P>
        <code>v1</code> is the lowercase hex HMAC-SHA256 of the string <code>&lt;t&gt;.&lt;raw request body&gt;</code>, keyed with your endpoint’s signing secret (the full <code>whsec_…</code> string):
      </P>
      <CodeBlock lang="text" title="Signed payload" code={`v1 = hex( HMAC_SHA256( key = signing_secret, message = t + "." + raw_body ) )`} />

      <H2>Verification steps</H2>
      <Steps
        items={[
          { title: 'Read the raw body', body: <>Use the exact bytes received. Parsing and re-serialising JSON changes whitespace and key order and breaks the signature.</> },
          { title: 'Parse the header', body: <>Split <code>ARAF-Signature</code> on commas into <code>t</code> and one or more <code>v1</code> values. Reject if either is missing.</> },
          { title: 'Check the timestamp', body: <>Reject if <code>|now − t| &gt; 300</code> seconds. This bounds replay attacks; keep your server clock in sync (NTP).</> },
          { title: 'Compute and compare', body: <>Compute the expected HMAC and compare with each <code>v1</code> using a constant-time comparison. Accept if <em>any</em> matches.</> },
          { title: 'De-duplicate', body: <>Record <code>event_id</code> and skip events you have already processed.</> },
        ]}
      />

      <H2>Examples</H2>
      <P>Drop-in verification for common stacks. The cURL tab shows how to send a correctly signed request to your own endpoint for local testing.</P>
      <CodeTabs tabs={VERIFY_TABS} />
      <Callout tone="gold" title="Test it in your browser">
        Paste a raw body, signature header and secret into the <Link href="/tools/webhook-verifier">signature verifier</Link>. It runs entirely in your browser with WebCrypto — nothing is sent anywhere.
      </Callout>

      <H2>Secret rotation</H2>
      <P>
        When you rotate an endpoint’s secret in the Partner portal, the new secret signs deliveries immediately and the previous secret keeps signing for <strong>24 hours</strong>. During that window the header carries two <code>v1</code> values — one per active secret:
      </P>
      <CodeBlock lang="text" code="ARAF-Signature: t=1795600502,v1=<signature with new secret>,v1=<signature with previous secret>" />
      <P>Deploy the new secret within 24 hours. Code that accepts any matching <code>v1</code> (as in the examples) works throughout the rotation.</P>

      <H2>Common mistakes</H2>
      <ul>
        <li>Verifying a re-serialised body (e.g. <code>JSON.stringify(req.body)</code>) instead of the raw bytes.</li>
        <li>
          Using <code>==</code> / <code>===</code> to compare signatures (timing leak) instead of <code>timingSafeEqual</code>, <code>hmac.compare_digest</code> or <code>hash_equals</code>.
        </li>
        <li>Only checking the first <code>v1</code> — breaks during secret rotation.</li>
        <li>Skipping the timestamp check, or using milliseconds instead of seconds.</li>
        <li>Stripping the <code>whsec_</code> prefix from the secret — the full string is the key.</li>
      </ul>
    </DocPage>
  );
}
