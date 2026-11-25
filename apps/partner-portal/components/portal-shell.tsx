'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppShell, Badge, LoadingBlock, SandboxBanner, ThemeToggle, cn, formatDateTime, type NavItem } from '@araf/ui';
import { api, useApi } from '@/lib/api';
import { ROLE_LABEL, useSession } from '@/lib/session';
import type { PartnerNotification, Permission } from '@/lib/types';
import { IconApplications, IconBell, IconIntegration, IconOverview, IconRelease, IconSettlements, IconShield, IconTeam } from './icons';

const NAV: Array<NavItem & { perm: Permission }> = [
  { href: '/', label: 'Overview', icon: <IconOverview />, perm: 'p.dashboard.read', section: 'Operations' },
  { href: '/applications', label: 'Applications', icon: <IconApplications />, perm: 'p.application.read', section: 'Operations' },
  { href: '/release', label: 'Ready for release', icon: <IconRelease />, perm: 'p.fulfilment.manage', section: 'Operations' },
  { href: '/settlements', label: 'Settlements', icon: <IconSettlements />, perm: 'p.settlement.read', section: 'Operations' },
  { href: '/integration', label: 'Integration', icon: <IconIntegration />, perm: 'p.integration.read', section: 'Settings' },
  { href: '/team', label: 'Team', icon: <IconTeam />, perm: 'p.dashboard.read', section: 'Settings' },
  { href: '/account', label: 'Security & sessions', icon: <IconShield />, perm: 'p.dashboard.read', section: 'Settings' },
];

export function PortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { me, can } = useSession();
  const nav = NAV.filter((n) => can(n.perm));
  return (
    <AppShell
      product="Partner"
      nav={nav}
      activeHref={pathname}
      renderLink={(item, className, content, onClick) => (
        <Link href={item.href} className={className} onClick={onClick} aria-current={pathname === item.href ? 'page' : undefined}>
          {content}
        </Link>
      )}
      banner={me.sandbox ? <SandboxBanner note={me.partner ? `${me.partner.tradingName} · ${me.partner.partnerCode}` : undefined} /> : undefined}
      topRight={
        <>
          {me.partner && (
            <span className="mr-1 hidden items-center gap-2 text-sm text-muted md:inline-flex">
              <span className="font-medium text-fg">{me.partner.tradingName}</span>
              <Badge tone={me.environment === 'SANDBOX' ? 'warning' : 'success'}>{me.environment === 'SANDBOX' ? 'Sandbox' : 'Live'}</Badge>
            </span>
          )}
          {can('p.dashboard.read') && <NotificationsBell />}
          <ThemeToggle />
          <UserMenu />
        </>
      }
    >
      {children}
    </AppShell>
  );
}

function useDisclosure() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function NotificationsBell() {
  const { open, setOpen, ref } = useDisclosure();
  const { data, loading, error, reload } = useApi<PartnerNotification[]>('/api/partner-portal/notifications');
  useEffect(() => {
    const t = setInterval(reload, 60_000);
    return () => clearInterval(t);
  }, [reload]);
  const unread = (data ?? []).filter((n) => !n.readAt).length;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) reload();
        }}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <IconBell />
        {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-semibold text-white dark:text-[#0c0c0d]">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-[min(92vw,380px)] overflow-hidden rounded-lg border border-border bg-surface shadow-md">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-fg">Notifications</p>
            <span className="text-xs text-subtle">Latest 50</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {loading && !data ? (
              <LoadingBlock rows={3} label="Loading notifications" />
            ) : error ? (
              <p className="px-4 py-6 text-sm text-danger">Notifications could not be loaded.</p>
            ) : !data?.length ? (
              <p className="px-4 py-8 text-center text-sm text-muted">No notifications yet. New applications and release authorisations appear here.</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.map((n) => (
                  <li key={n.id} className="px-4 py-3">
                    <p className="text-sm font-medium text-fg">{n.subject}</p>
                    <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{n.body}</p>
                    <p className="mt-1 text-2xs text-subtle">{formatDateTime(n.createdAt)}</p>
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

function UserMenu() {
  const { me } = useSession();
  const { open, setOpen, ref } = useDisclosure();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const initials = me.user.full_name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const signOut = async () => {
    setBusy(true);
    try {
      await api.post('/api/auth/partner/logout');
    } catch {
      /* session may already be gone */
    }
    router.replace('/login?signed_out=1');
  };
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Account menu for ${me.user.full_name}`}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink text-xs font-semibold text-ink-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
      >
        {initials}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-64 rounded-lg border border-border bg-surface py-1 shadow-md">
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-semibold text-fg">{me.user.full_name}</p>
            <p className="truncate text-xs text-muted">{me.user.email}</p>
            <p className="mt-1 text-xs text-subtle">{me.user.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ')}</p>
          </div>
          <Link href="/account" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-sm text-fg hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none">
            Security &amp; sessions
          </Link>
          <button type="button" onClick={signOut} disabled={busy} className={cn('block w-full px-4 py-2.5 text-left text-sm text-danger hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none', busy && 'opacity-60')}>
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
