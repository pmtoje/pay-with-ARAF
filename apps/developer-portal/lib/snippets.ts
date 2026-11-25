import type { CodeTab } from '@/components/code';
import { BASE_URL, CHECKOUT_BODY, json } from './examples';

const body = json(CHECKOUT_BODY);

export const CREATE_SESSION_TABS: CodeTab[] = [
  {
    label: 'cURL',
    lang: 'bash',
    code: `
curl -X POST ${BASE_URL}/checkout/sessions \\
  -H "Authorization: Bearer $ARAF_SECRET_KEY" \\
  -H "Idempotency-Key: order-ORD-10045-attempt-1" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(CHECKOUT_BODY)}'`,
  },
  {
    label: 'JavaScript',
    lang: 'javascript',
    title: 'server.js (Node 18+)',
    code: `
// Server-side only. Never call the API from the browser.
const res = await fetch('${BASE_URL}/checkout/sessions', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.ARAF_SECRET_KEY}\`,
    'Idempotency-Key': \`order-\${order.id}-attempt-\${order.attempt}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(${body.replace(/\n/g, '\n  ')}),
});
const session = await res.json();
if (!res.ok) throw new Error(\`\${session.error.code} (\${session.error.correlation_id})\`);
// Redirect the customer to the hosted checkout
return Response.redirect(session.checkout_url, 303);`,
  },
  {
    label: 'TypeScript',
    lang: 'typescript',
    title: 'app/api/checkout/route.ts (Next.js)',
    code: `
interface CheckoutSession {
  session_id: string;
  application_reference: string;
  checkout_url: string;
  status: string;
  expires_at: string;
}

export async function POST(req: Request): Promise<Response> {
  const order = await loadOrderFromYourDatabase(req); // never trust amounts from the browser
  const res = await fetch(\`\${process.env.ARAF_API_BASE_URL}/checkout/sessions\`, {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${process.env.ARAF_SECRET_KEY}\`,
      'Idempotency-Key': \`order-\${order.reference}-v\${order.revision}\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      merchant_order_reference: order.reference,
      currency: 'NGN',
      amount: order.totalKobo, // integer kobo = sum(unit_amount × quantity)
      items: order.lines.map((l) => ({
        sku: l.sku, name: l.name, quantity: l.quantity,
        unit_amount: l.unitKobo, category: l.category, vendor_reference: l.vendorRef,
      })),
      customer: { email: order.email, phone: order.phone },
      return_url: \`https://shop.example.com/orders/\${order.reference}\`,
      cancel_url: 'https://shop.example.com/cart',
    }),
  });
  if (!res.ok) {
    const { error } = await res.json();
    return Response.json({ code: error.code, correlation_id: error.correlation_id }, { status: 502 });
  }
  const session = (await res.json()) as CheckoutSession;
  await saveSessionId(order.reference, session.session_id, session.application_reference);
  return Response.redirect(session.checkout_url, 303);
}`,
  },
  {
    label: 'Python',
    lang: 'python',
    title: 'checkout.py (requests)',
    code: `
import os, requests

payload = ${body.replace(/true/g, 'True').replace(/false/g, 'False')}

res = requests.post(
    "${BASE_URL}/checkout/sessions",
    json=payload,
    headers={
        "Authorization": f"Bearer {os.environ['ARAF_SECRET_KEY']}",
        "Idempotency-Key": "order-ORD-10045-attempt-1",
    },
    timeout=15,
)
session = res.json()
if not res.ok:
    raise RuntimeError(f"{session['error']['code']} ({session['error']['correlation_id']})")
redirect_to = session["checkout_url"]`,
  },
  {
    label: 'PHP',
    lang: 'php',
    title: 'checkout.php',
    code: `
<?php
$payload = json_decode(<<<'JSON'
${body}
JSON, true);

$ch = curl_init('${BASE_URL}/checkout/sessions');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . getenv('ARAF_SECRET_KEY'),
        'Idempotency-Key: order-ORD-10045-attempt-1',
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => json_encode($payload),
]);
$session = json_decode(curl_exec($ch), true);
$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
if ($status !== 201 && $status !== 200) {
    throw new RuntimeException($session['error']['code'] . ' ' . $session['error']['correlation_id']);
}
header('Location: ' . $session['checkout_url'], true, 303);`,
  },
];

export const VERIFY_TABS: CodeTab[] = [
  {
    label: 'JavaScript',
    lang: 'javascript',
    title: 'webhooks.js (Node + Express)',
    code: `
import crypto from 'node:crypto';
import express from 'express';

const TOLERANCE_SECONDS = 300;

export function verifyArafSignature(rawBody, header, secret, now = Math.floor(Date.now() / 1000)) {
  if (!header) return false;
  let timestamp = null;
  const signatures = [];
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (key === 't' && /^\\d+$/.test(value)) timestamp = Number(value);
    else if (key === 'v1' && /^[0-9a-f]{64}$/.test(value)) signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(now - timestamp) > TOLERANCE_SECONDS) return false;
  const expected = crypto.createHmac('sha256', secret).update(\`\${timestamp}.\${rawBody}\`).digest();
  // During secret rotation the header carries one v1 per active secret: accept any match.
  return signatures.some((sig) => {
    const candidate = Buffer.from(sig, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  });
}

const app = express();
// Use the RAW body: re-serialised JSON will not match the signature.
app.post('/webhooks/araf', express.raw({ type: 'application/json' }), async (req, res) => {
  const raw = req.body.toString('utf8');
  if (!verifyArafSignature(raw, req.get('ARAF-Signature'), process.env.ARAF_WEBHOOK_SECRET)) {
    return res.status(400).send('Invalid signature');
  }
  const event = JSON.parse(raw);
  if (await db.processedEvents.exists(event.event_id)) return res.sendStatus(200); // duplicate
  await queue.add('araf-event', event); // process asynchronously, respond fast
  await db.processedEvents.insert(event.event_id);
  res.sendStatus(200);
});`,
  },
  {
    label: 'TypeScript',
    lang: 'typescript',
    title: 'app/webhooks/araf/route.ts (Next.js)',
    code: `
import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 300;

export function verifyArafSignature(rawBody: string, header: string | null, secret: string, now = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value = ''] = part.trim().split('=', 2);
    if (key === 't' && /^\\d+$/.test(value)) timestamp = Number(value);
    else if (key === 'v1' && /^[0-9a-f]{64}$/.test(value)) signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(now - timestamp) > TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(\`\${timestamp}.\${rawBody}\`).digest();
  return signatures.some((sig) => {
    const candidate = Buffer.from(sig, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

interface ArafEvent {
  event_id: string;
  event: string;
  version: string;
  created_at: string;
  livemode: boolean;
  test?: boolean;
  resource_version: number;
  data: { application_reference: string | null; merchant_order_reference: string | null; status?: string; [k: string]: unknown };
}

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text(); // raw body, exactly as received
  if (!verifyArafSignature(raw, req.headers.get('ARAF-Signature'), process.env.ARAF_WEBHOOK_SECRET!)) {
    return new Response('Invalid signature', { status: 400 });
  }
  const event = JSON.parse(raw) as ArafEvent;
  await handleOnce(event); // de-duplicate by event.event_id, ignore stale resource_version
  return new Response(null, { status: 200 });
}`,
  },
  {
    label: 'Python',
    lang: 'python',
    title: 'webhooks.py (Flask)',
    code: `
import hashlib, hmac, json, os, re, time
from flask import Flask, abort, request

TOLERANCE_SECONDS = 300

def verify_araf_signature(raw_body: bytes, header: str | None, secret: str, now: float | None = None) -> bool:
    if not header:
        return False
    timestamp, signatures = None, []
    for part in header.split(","):
        key, _, value = part.strip().partition("=")
        if key == "t" and value.isdigit():
            timestamp = int(value)
        elif key == "v1" and re.fullmatch(r"[0-9a-f]{64}", value):
            signatures.append(value)
    if timestamp is None or not signatures:
        return False
    if abs((now or time.time()) - timestamp) > TOLERANCE_SECONDS:
        return False
    signed = f"{timestamp}.".encode() + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, sig) for sig in signatures)

app = Flask(__name__)

@app.post("/webhooks/araf")
def araf_webhook():
    raw = request.get_data()  # raw bytes, before any JSON parsing
    if not verify_araf_signature(raw, request.headers.get("ARAF-Signature"), os.environ["ARAF_WEBHOOK_SECRET"]):
        abort(400)
    event = json.loads(raw)
    handle_once(event)  # idempotent by event["event_id"]
    return "", 200`,
  },
  {
    label: 'PHP',
    lang: 'php',
    title: 'webhooks.php',
    code: `
<?php
const ARAF_TOLERANCE_SECONDS = 300;

function araf_verify_signature(string $rawBody, ?string $header, string $secret, ?int $now = null): bool
{
    if (!$header) return false;
    $timestamp = null;
    $signatures = [];
    foreach (explode(',', $header) as $part) {
        [$key, $value] = array_pad(explode('=', trim($part), 2), 2, '');
        if ($key === 't' && ctype_digit($value)) $timestamp = (int) $value;
        elseif ($key === 'v1' && preg_match('/^[0-9a-f]{64}$/', $value)) $signatures[] = $value;
    }
    if ($timestamp === null || !$signatures) return false;
    if (abs(($now ?? time()) - $timestamp) > ARAF_TOLERANCE_SECONDS) return false;
    $expected = hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);
    foreach ($signatures as $sig) {
        if (hash_equals($expected, $sig)) return true; // constant-time
    }
    return false;
}

$raw = file_get_contents('php://input'); // raw body
if (!araf_verify_signature($raw, $_SERVER['HTTP_ARAF_SIGNATURE'] ?? null, getenv('ARAF_WEBHOOK_SECRET'))) {
    http_response_code(400);
    exit('Invalid signature');
}
$event = json_decode($raw, true);
handle_once($event); // idempotent by $event['event_id']
http_response_code(200);`,
  },
  {
    label: 'cURL',
    lang: 'bash',
    title: 'Send a correctly signed test request to your own endpoint',
    code: `
BODY='{"event_id":"evt_local_test","event":"goods.release_authorized","version":"1.0","created_at":"2026-11-25T10:55:02.441Z","livemode":false,"test":true,"resource_version":0,"data":{"application_reference":"ARAF-TEST-000000","merchant_order_reference":"TEST-ORDER","release_authorized":true,"release_reference":"REL-TEST"}}'
TS=$(date +%s)
SIG=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$ARAF_WEBHOOK_SECRET" -hex | sed 's/^.* //')

curl -X POST https://localhost:3000/webhooks/araf \\
  -H "Content-Type: application/json" \\
  -H "ARAF-Signature: t=$TS,v1=$SIG" \\
  -H "ARAF-Timestamp: $TS" \\
  -H "ARAF-Event-Id: evt_local_test" \\
  --data "$BODY"`,
  },
];

export function curlGet(path: string) {
  return `curl ${BASE_URL}${path} \\\n  -H "Authorization: Bearer $ARAF_SECRET_KEY"`;
}

export function curlPost(path: string, payload?: unknown) {
  return `curl -X POST ${BASE_URL}${path} \\\n  -H "Authorization: Bearer $ARAF_SECRET_KEY" \\\n  -H "Content-Type: application/json"${payload ? ` \\\n  -d '${JSON.stringify(payload)}'` : ''}`;
}

export function fetchTabs(method: 'GET' | 'POST', path: string, payload?: unknown): CodeTab[] {
  const pyPayload = payload ? `, json=${JSON.stringify(payload).replace(/true/g, 'True').replace(/false/g, 'False')}` : '';
  return [
    { label: 'cURL', lang: 'bash', code: method === 'GET' ? curlGet(path) : curlPost(path, payload) },
    {
      label: 'JavaScript',
      lang: 'javascript',
      code: `const res = await fetch(\`\${process.env.ARAF_API_BASE_URL}${path}\`, {\n  method: '${method}',\n  headers: { Authorization: \`Bearer \${process.env.ARAF_SECRET_KEY}\`${payload ? ", 'Content-Type': 'application/json'" : ''} },${payload ? `\n  body: JSON.stringify(${JSON.stringify(payload)}),` : ''}\n});\nconst data = await res.json();`,
    },
    {
      label: 'TypeScript',
      lang: 'typescript',
      code: `const res = await fetch(\`\${process.env.ARAF_API_BASE_URL}${path}\`, {\n  method: '${method}',\n  headers: { Authorization: \`Bearer \${process.env.ARAF_SECRET_KEY!}\`${payload ? ", 'Content-Type': 'application/json'" : ''} },${payload ? `\n  body: JSON.stringify(${JSON.stringify(payload)}),` : ''}\n});\nif (!res.ok) throw new Error((await res.json()).error.code);\nconst data: unknown = await res.json();`,
    },
    {
      label: 'Python',
      lang: 'python',
      code: `res = requests.${method.toLowerCase()}(\n    f"{os.environ['ARAF_API_BASE_URL']}${path}"${pyPayload},\n    headers={"Authorization": f"Bearer {os.environ['ARAF_SECRET_KEY']}"},\n    timeout=15,\n)\ndata = res.json()`,
    },
    {
      label: 'PHP',
      lang: 'php',
      code: `$ch = curl_init(getenv('ARAF_API_BASE_URL') . '${path}');\ncurl_setopt_array($ch, [\n    CURLOPT_RETURNTRANSFER => true,${method === 'POST' ? `\n    CURLOPT_POST => true,\n    CURLOPT_POSTFIELDS => json_encode(${payload ? `json_decode('${JSON.stringify(payload)}', true)` : '[]'}),` : ''}\n    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . getenv('ARAF_SECRET_KEY')${method === 'POST' ? ", 'Content-Type: application/json'" : ''}],\n]);\n$data = json_decode(curl_exec($ch), true);`,
    },
  ];
}
