/** @type {import('next').NextConfig} */
const API_URL = process.env.ARAF_API_URL ?? 'http://localhost:4000';

const CSP_BASE = `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'`;

const common = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

// Pages that are never embedded: no framing at all.
const securityHeaders = [
  // Inline scripts are limited to Next's runtime and the theme bootstrap; no third-party origins.
  { key: 'Content-Security-Policy', value: `${CSP_BASE}; frame-ancestors 'none'` },
  { key: 'X-Frame-Options', value: 'DENY' },
  ...common,
];

export default {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@araf/ui', '@araf/design-tokens'],
  async headers() {
    return [
      // Checkout pages may be embedded by the session's approved merchant websites only:
      // middleware.ts sets the per-session CSP (frame-ancestors) for /c/* and /sandbox/*.
      { source: '/((?!c/|sandbox/|v1/).*)', headers: securityHeaders },
      { source: '/(c|sandbox)/:path*', headers: common },
      // The embed SDK is a public, cacheable script loaded by merchant websites.
      { source: '/v1/:path*', headers: [...common, { key: 'Cache-Control', value: 'public, max-age=300' }, { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' }] },
    ];
  },
  // Same-origin proxy: the browser never talks to the API origin directly, so session cookies
  // stay HttpOnly + SameSite=Strict on this origin and no CORS is required.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};
