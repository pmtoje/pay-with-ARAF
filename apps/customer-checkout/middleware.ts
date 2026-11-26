import { NextResponse, type NextRequest } from 'next/server';

/**
 * Embedded checkout framing policy.
 *
 * /c/{session} may be shown inside an iframe ONLY on the merchant websites the Bank approved for
 * that session's partner (frame-ancestors). Everything else stays unframeable. Provider stand-in
 * pages under /sandbox/* reuse the policy of the checkout that opened them (remembered in an
 * HttpOnly cookie), so a step that leaves the checkout still stays inside the merchant's panel.
 */
const API_URL = process.env.ARAF_API_URL ?? 'http://localhost:4000';
const DEV = process.env.NODE_ENV === 'development';
const CSP_BASE = `default-src 'self'; script-src 'self' 'unsafe-inline'${DEV ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'`;
const ANC_COOKIE = 'araf_embed_anc';
const cache = new Map<string, { origins: string[]; at: number }>();
const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;

async function originsFor(sessionId: string): Promise<string[]> {
  const hit = cache.get(sessionId);
  if (hit && Date.now() - hit.at < 60_000) return hit.origins;
  try {
    const r = await fetch(`${API_URL}/api/checkout/sessions/${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
    if (!r.ok) return [];
    const body = (await r.json()) as { embed_origins?: string[] };
    const origins = (body.embed_origins ?? []).filter((o) => ORIGIN_RE.test(o));
    cache.set(sessionId, { origins, at: Date.now() });
    if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
    return origins;
  } catch {
    return [];
  }
}

function withPolicy(res: NextResponse, origins: string[]) {
  const ancestors = origins.length ? `'self' ${origins.join(' ')}` : "'none'";
  res.headers.set('Content-Security-Policy', `${CSP_BASE}; frame-ancestors ${ancestors}`);
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const m = /^\/c\/([A-Za-z0-9_]{6,80})(?:\/|$)/.exec(pathname);
  if (m) {
    const origins = await originsFor(m[1]);
    const res = withPolicy(NextResponse.next(), origins);
    res.cookies.set(ANC_COOKIE, origins.join(' '), { httpOnly: true, sameSite: DEV ? 'lax' : 'none', secure: !DEV, path: '/sandbox', maxAge: 3600 });
    return res;
  }
  const remembered = (req.cookies.get(ANC_COOKIE)?.value ?? '').split(' ').filter((o) => ORIGIN_RE.test(o));
  return withPolicy(NextResponse.next(), remembered);
}

export const config = { matcher: ['/c/:path*', '/sandbox/:path*'] };
