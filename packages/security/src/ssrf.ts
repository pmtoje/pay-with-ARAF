import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Outbound URL safety for partner-supplied webhook endpoints (SSRF / DNS rebinding).
 *
 * - HTTPS only (HTTP allowed only when explicitly permitted for local sandbox).
 * - No embedded credentials, no fragments, standard ports only.
 * - Every resolved address must be public; the caller connects to the PINNED address
 *   returned here (with the original Host/SNI) so a second DNS answer cannot rebind.
 * - Redirects must not be followed by the caller.
 */

export interface UrlPolicy {
  allowHttp: boolean;
  allowPrivateNetworks: boolean;
  allowedPorts?: number[];
}

export class UnsafeUrlError extends Error {
  constructor(public readonly code: string) {
    super(`Unsafe outbound URL: ${code}`);
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function inCidr4(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const PRIVATE_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return PRIVATE_V4.some(([b, n]) => inCidr4(ip, b, n));
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      lower.startsWith('fc') ||
      lower.startsWith('fd') || // unique local
      /^fe[89ab]/.test(lower) || // link local
      lower.startsWith('ff') || // multicast
      lower.startsWith('2001:db8') || // documentation
      lower.startsWith('64:ff9b') // NAT64
    );
  }
  return true; // not an IP → treat as unsafe
}

export function validateUrlSyntax(raw: string, policy: UrlPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('INVALID_URL');
  }
  if (url.protocol !== 'https:' && !(policy.allowHttp && url.protocol === 'http:')) throw new UnsafeUrlError('HTTPS_REQUIRED');
  if (url.username || url.password) throw new UnsafeUrlError('CREDENTIALS_IN_URL');
  if (url.hash) throw new UnsafeUrlError('FRAGMENT_NOT_ALLOWED');
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  const allowedPorts = policy.allowedPorts ?? (policy.allowPrivateNetworks ? undefined : [443, 8443]);
  if (allowedPorts && !allowedPorts.includes(port)) throw new UnsafeUrlError('PORT_NOT_ALLOWED');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!policy.allowPrivateNetworks) {
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
      throw new UnsafeUrlError('PRIVATE_HOSTNAME');
    }
    if (isIP(host) && isPrivateAddress(host)) throw new UnsafeUrlError('PRIVATE_ADDRESS');
  }
  return url;
}

export interface ResolvedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

export type Resolver = (host: string) => Promise<Array<{ address: string; family: 4 | 6 }>>;

const systemResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })) as Array<{ address: string; family: 4 | 6 }>;

export async function resolveSafeTarget(raw: string, policy: UrlPolicy, resolver: Resolver = systemResolver): Promise<ResolvedTarget> {
  const url = validateUrlSyntax(raw, policy);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const version = isIP(host);
  const addresses = version
    ? [{ address: host, family: version as 4 | 6 }]
    : await resolver(host).catch(() => {
        throw new UnsafeUrlError('DNS_RESOLUTION_FAILED');
      });
  if (!addresses.length) throw new UnsafeUrlError('DNS_RESOLUTION_FAILED');
  if (!policy.allowPrivateNetworks && addresses.some((a) => isPrivateAddress(a.address))) {
    throw new UnsafeUrlError('RESOLVES_TO_PRIVATE_ADDRESS');
  }
  return { url, address: addresses[0].address, family: addresses[0].family };
}
