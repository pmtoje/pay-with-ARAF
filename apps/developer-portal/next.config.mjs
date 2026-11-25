/** @type {import('next').NextConfig} */
const API_URL = process.env.ARAF_API_URL ?? 'http://localhost:4000';

const securityHeaders = [
  // Inline scripts are limited to Next's runtime and the theme bootstrap; no third-party origins.
  { key: 'Content-Security-Policy', value: `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

export default {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@araf/ui', '@araf/design-tokens'],
  // Reference data (API scopes, webhook events, error catalogue, sandbox identities) is imported
  // straight from the dependency-free source files in packages/, so the UI never drifts from the API.
  experimental: { externalDir: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // Same-origin proxy: the browser never talks to the API origin directly, so session cookies
  // stay HttpOnly + SameSite=Strict on this origin and no CORS is required.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};
