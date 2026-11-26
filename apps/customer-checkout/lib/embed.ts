/**
 * Embedded mode: the checkout runs inside a merchant page (ArafCheckout.open from /v1/araf.js).
 *
 * The parent page's origin is learned from the SDK's hello message (event.origin) or, where the
 * browser exposes it, location.ancestorOrigins, and is accepted only if it is one of the approved
 * merchant origins for this session. Messages carry status only — never personal or credit data.
 */
const KEY = 'araf_embed_parent';
let parent: string | null = null;
let allowed: string[] = [];

export function isEmbedded(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function remember(origin: string) {
  parent = origin;
  try {
    sessionStorage.setItem(KEY, origin);
  } catch {
    /* ignore */
  }
}

export function initEmbed(approvedOrigins: string[], onParent?: () => void) {
  if (!isEmbedded()) return () => undefined;
  allowed = approvedOrigins;
  try {
    const stored = sessionStorage.getItem(KEY);
    if (stored && allowed.includes(stored)) parent = stored;
  } catch {
    /* ignore */
  }
  const anc = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  const top = anc && anc.length ? anc[anc.length - 1] : null;
  if (!parent && top && allowed.includes(top)) remember(top);
  const onMessage = (ev: MessageEvent) => {
    const d = ev.data as { source?: string; type?: string } | null;
    if (ev.source !== window.parent || !d || d.source !== 'araf-merchant' || d.type !== 'araf:hello') return;
    if (!allowed.includes(ev.origin)) return;
    const first = !parent;
    remember(ev.origin);
    if (first) onParent?.();
  };
  window.addEventListener('message', onMessage);
  post('araf:ready');
  return () => window.removeEventListener('message', onMessage);
}

export function post(type: string, data: Record<string, unknown> = {}) {
  if (!isEmbedded()) return;
  if (!parent) {
    // Before the parent is known we only announce readiness (no data) so the SDK can say hello.
    if (type === 'araf:ready') window.parent.postMessage({ source: 'araf-checkout', version: 1, type }, '*');
    return;
  }
  window.parent.postMessage({ source: 'araf-checkout', version: 1, type, ...data }, parent);
}

/** Close the merchant's panel and hand the shopper back to the store page they are already on. */
export function closeEmbed(reason: 'return' | 'cancel' | 'equity' | 'customer' | 'complete') {
  post('araf:close', { reason });
}
