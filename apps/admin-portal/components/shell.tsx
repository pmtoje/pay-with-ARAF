'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppShell, Badge, Button, Dialog, LoadingBlock, SandboxBanner, ThemeToggle, formatDateTime, type NavItem } from '@araf/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { roleLabel } from '@/lib/labels';
import { ErrorAlert, useToast } from './common';
import { Icon } from './icons';

interface NavDef extends NavItem {
  perm?: string;
}

export function navFor(can: (p: string) => boolean, sandbox: boolean, arafConnected = false): NavDef[] {
  const all: NavDef[] = [
    { href: '/', label: 'Executive overview', icon: Icon.overview(), section: 'Overview', perm: 'report.read' },
    { href: '/approvals', label: 'Approvals inbox', icon: Icon.approvals(), section: 'Work queues' },
    { href: '/applications', label: 'Applications', icon: Icon.applications(), section: 'Work queues', perm: 'application.read' },
    { href: '/reviews', label: 'Credit reviews', icon: Icon.reviews(), section: 'Work queues', perm: 'application.read.sensitive' },
    { href: '/araf-simulator', label: 'ARAF simulator', icon: Icon.araf(), section: 'Work queues', perm: 'application.read' },
    { href: '/operations', label: 'Operations', icon: Icon.operations(), section: 'Work queues', perm: 'application.read' },
    { href: '/reconciliation', label: 'Reconciliation', icon: Icon.reconcile(), section: 'Work queues', perm: 'payment.reconcile' },
    { href: '/fees', label: 'Fees & invoices', icon: Icon.reconcile(), section: 'Work queues', perm: 'fee.manage' },
    { href: '/partners', label: 'Partners', icon: Icon.partners(), section: 'Portfolio', perm: 'partner.read' },
    { href: '/policy', label: 'Credit policy', icon: Icon.policy(), section: 'Portfolio', perm: 'policy.read' },
    { href: '/reports', label: 'Reports', icon: Icon.reports(), section: 'Insight', perm: 'report.read' },
    { href: '/audit', label: 'Audit log', icon: Icon.audit(), section: 'Insight', perm: 'audit.read' },
    { href: '/users', label: 'Users & roles', icon: Icon.users(), section: 'Platform', perm: 'user.manage' },
    { href: '/integrations', label: 'Integrations', icon: Icon.integrations(), section: 'Platform', perm: 'integration.read' },
  ];
  if (sandbox) all.push({ href: '/sandbox', label: 'Sandbox tools', icon: Icon.sandbox(), section: 'Platform' });
  // Connected to the real ARAF: credit decisions are made in ARAF, so the simulator is not offered.
  return all.filter((n) => (!n.perm || can(n.perm)) && !(arafConnected && n.href === '/araf-simulator'));
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { me, can } = useSession();
  const pending = useApi<Array<{ can_decide: boolean }>>('/api/admin/approvals?status=PENDING', { pollMs: 60_000 });
  const actionable = pending.data?.filter((a) => a.can_decide).length ?? 0;
  const nav = navFor(can, me.sandbox, me.araf_connected).map((n) =>
    n.href === '/approvals' && actionable > 0
      ? { ...n, badge: <span className="rounded-sm bg-gold px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-white dark:text-[#0c0c0d]" aria-label={`${actionable} awaiting your decision`}>{actionable}</span> }
      : n,
  );
  return (
    <AppShell
      product="Admin"
      nav={nav}
      activeHref={pathname}
      banner={me.sandbox ? <SandboxBanner note="Bank administration portal" /> : undefined}
      renderLink={(item, className, content, onClick) => (
        <Link href={item.href} className={className} onClick={onClick} aria-current={pathname === item.href ? 'page' : undefined}>
          {content}
        </Link>
      )}
      topRight={
        <>
          <span className="mr-1 hidden items-center gap-1.5 rounded-sm border border-border px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-muted md:inline-flex">
            <span className={me.environment === 'PRODUCTION' ? 'text-danger' : 'text-warning'}>{Icon.dot()}</span>
            {me.environment}
          </span>
          <NotificationsBell />
          <ThemeToggle />
          <UserMenu />
        </>
      }
    >
      {children}
    </AppShell>
  );
}

// ---- Notifications -------------------------------------------------------------------------

interface Notification {
  id: string;
  subject: string;
  body: string;
  templateCode: string;
  channel: string;
  status: string;
  applicationId: string | null;
  readAt: string | null;
  createdAt: string;
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const SEEN_KEY = 'araf-admin-notifications-seen';

function NotificationsBell() {
  const { open, setOpen, ref } = usePopover();
  const state = useApi<Notification[]>('/api/admin/notifications', { pollMs: 60_000 });
  const [seen, setSeen] = useState<string | null>(null);
  useEffect(() => {
    try {
      setSeen(localStorage.getItem(SEEN_KEY));
    } catch {
      /* storage unavailable */
    }
  }, []);
  const items = state.data ?? [];
  const unread = items.filter((n) => !seen || n.createdAt > seen).length;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && items[0]) {
      try {
        localStorage.setItem(SEEN_KEY, items[0].createdAt);
      } catch {
        /* ignore */
      }
      setTimeout(() => setSeen(items[0].createdAt), 1500);
    }
  };
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="true" aria-label={`Notifications${unread ? `, ${unread} new` : ''}`} className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        {Icon.bell('h-[18px] w-[18px]')}
        {unread > 0 && <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-gold px-1 text-center text-[10px] font-semibold leading-4 text-white dark:text-[#0c0c0d]">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface shadow-md">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            <button type="button" className="text-xs text-muted hover:text-fg" onClick={state.reload}>Refresh</button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {state.error ? (
              <div className="p-3"><ErrorAlert error={state.error} /></div>
            ) : !state.data ? (
              <LoadingBlock rows={3} />
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">No Bank notifications yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((n) => (
                  <li key={n.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-fg">{n.subject}</p>
                      {(!seen || n.createdAt > seen) && <span className="mt-1.5 text-gold">{Icon.dot()}</span>}
                    </div>
                    <p className="mt-0.5 line-clamp-3 text-xs text-muted">{n.body}</p>
                    <p className="mt-1 text-2xs text-subtle">
                      {formatDateTime(n.createdAt)}
                      {n.applicationId && (
                        <>
                          {' · '}
                          <Link className="text-gold-strong hover:underline" href={`/applications/${n.applicationId}`} onClick={() => setOpen(false)}>Open application</Link>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- User menu --------------------------------------------------------------------------

interface SessionRow { id: string; created_at: string; last_seen_at: string | null; ip_address: string | null; user_agent: string | null; current: boolean }

function UserMenu() {
  const { me } = useSession();
  const { open, setOpen, ref } = usePopover();
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();
  const initials = me.user.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('');
  const signOut = async () => {
    setSigningOut(true);
    try {
      await api.post('/api/auth/admin/logout');
    } catch {
      /* session may already be gone */
    }
    router.replace('/login?reason=SIGNED_OUT');
  };
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true" className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-xs font-semibold text-ink-contrast" aria-hidden="true">{initials}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-medium text-fg">{me.user.full_name}</span>
          <span className="block max-w-[11rem] truncate text-2xs text-subtle">{me.user.roles.map(roleLabel).join(', ')}</span>
        </span>
        <span className="sr-only">Account menu</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-lg border border-border bg-surface shadow-md">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">{me.user.full_name}</p>
            <p className="truncate text-xs text-muted">{me.user.email}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {me.user.roles.map((r) => (
                <Badge key={r} tone="gold">{roleLabel(r)}</Badge>
              ))}
            </div>
            <p className="mt-2 text-2xs text-subtle">{me.user.permissions.length} permissions · MFA verified</p>
          </div>
          <div className="p-1.5">
            <button type="button" className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => { setOpen(false); setSessionsOpen(true); }}>
              Active sessions
            </button>
            <button type="button" className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-danger hover:bg-surface-2 disabled:opacity-50" disabled={signingOut} onClick={signOut}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      )}
      <SessionsDialog open={sessionsOpen} onClose={() => setSessionsOpen(false)} />
    </div>
  );
}

function SessionsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useApi<{ data: SessionRow[] }>(open ? '/api/auth/admin/sessions' : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const revoke = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await api.post(`/api/auth/admin/sessions/${id}/revoke`);
      toast('Session revoked');
      state.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Active sessions" description="Sessions expire after 15 minutes of inactivity and 8 hours at most. Revoke any session you do not recognise." footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {error ? <ErrorAlert error={error} className="mb-3" /> : null}
      {state.error ? (
        <ErrorAlert error={state.error} onRetry={state.reload} />
      ) : !state.data ? (
        <LoadingBlock rows={3} />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {state.data.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{describeAgent(s.user_agent)}</span>
                  {s.current && <Badge tone="success">This session</Badge>}
                </p>
                <p className="text-xs text-muted">
                  {s.ip_address ?? 'Unknown IP'} · signed in {formatDateTime(s.created_at)} · last active {formatDateTime(s.last_seen_at)}
                </p>
              </div>
              {!s.current && (
                <Button size="sm" variant="secondary" loading={busy === s.id} onClick={() => revoke(s.id)}>Revoke</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /node|undici/i.test(ua) ? 'API client' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
