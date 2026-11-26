export interface DocLink {
  href: string;
  title: string;
}

export const DOC_NAV: Array<{ section: string; items: DocLink[] }> = [
  {
    section: 'Get started',
    items: [
      { href: '/', title: 'Overview' },
      { href: '/environments', title: 'Sandbox & production' },
      { href: '/authentication', title: 'Authentication' },
    ],
  },
  {
    section: 'Accept payments',
    items: [
      { href: '/checkout-sessions', title: 'Create a checkout session' },
      { href: '/embedded-checkout', title: 'Embedded checkout (no redirect)' },
      { href: '/redirects', title: 'Redirects & return URLs' },
      { href: '/applications', title: 'Application status' },
    ],
  },
  {
    section: 'Webhooks',
    items: [
      { href: '/webhooks', title: 'Receiving webhooks' },
      { href: '/webhooks/events', title: 'Event catalogue' },
      { href: '/webhooks/signatures', title: 'Verifying signatures' },
    ],
  },
  {
    section: 'Orders & money',
    items: [
      { href: '/releases', title: 'Goods release verification' },
      { href: '/fulfilment', title: 'Fulfilment, cancellations & returns' },
      { href: '/settlements', title: 'Settlements & event history' },
    ],
  },
  {
    section: 'Reference',
    items: [
      { href: '/errors', title: 'Errors & idempotency' },
      { href: '/api-reference', title: 'API reference' },
      { href: '/sandbox', title: 'Sandbox testing' },
      { href: '/go-live', title: 'Production checklist' },
    ],
  },
  {
    section: 'Tools',
    items: [
      { href: '/explorer', title: 'API explorer' },
      { href: '/tools/webhook-verifier', title: 'Signature verifier' },
    ],
  },
  {
    section: 'More',
    items: [
      { href: '/changelog', title: 'Changelog' },
      { href: '/support', title: 'Support' },
    ],
  },
];

export const FLAT_NAV: DocLink[] = DOC_NAV.flatMap((s) => s.items);
