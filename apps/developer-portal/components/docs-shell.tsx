'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Logo, ThemeToggle, cn } from '@araf/ui';
import { DOC_NAV } from '@/lib/nav';

const TOP_LINKS = [
  { href: '/', label: 'Docs', match: (p: string) => !p.startsWith('/explorer') && !p.startsWith('/tools') && !p.startsWith('/api-reference') },
  { href: '/api-reference', label: 'API reference', match: (p: string) => p.startsWith('/api-reference') },
  { href: '/explorer', label: 'API explorer', match: (p: string) => p.startsWith('/explorer') },
  { href: '/tools/webhook-verifier', label: 'Signature verifier', match: (p: string) => p.startsWith('/tools') },
];

function SideNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Documentation" className="space-y-6 px-4 py-6 text-sm">
      {DOC_NAV.map((s) => (
        <div key={s.section}>
          <p className="mb-1.5 px-2 text-2xs font-semibold uppercase tracking-[0.14em] text-subtle">{s.section}</p>
          <ul className="space-y-0.5">
            {s.items.map((i) => {
              const active = pathname === i.href;
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'block rounded-md border-l-2 px-2 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                      active ? 'border-gold bg-gold-soft/60 font-medium text-fg' : 'border-transparent text-muted hover:bg-surface-2 hover:text-fg',
                    )}
                  >
                    {i.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function DocsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);
  return (
    <div className="min-h-screen bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[90rem] items-center gap-4 px-4 sm:px-6">
          <button type="button" onClick={() => setOpen(true)} className="-ml-1 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-surface-2 lg:hidden" aria-label="Open documentation menu" aria-expanded={open}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>
          <Link href="/" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" aria-label="Pay with ARAF Developers home">
            <Logo product="Developers" />
          </Link>
          <nav aria-label="Primary" className="ml-6 hidden items-center gap-1 md:flex">
            {TOP_LINKS.map((l) => (
              <Link key={l.href} href={l.href} aria-current={l.match(pathname) ? 'page' : undefined} className={cn('rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', l.match(pathname) ? 'text-fg' : 'text-muted hover:text-fg')}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden rounded-sm bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning sm:inline">API v1 · Sandbox</span>
            <ThemeToggle />
          </div>
        </div>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Documentation menu">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 w-80 max-w-[85vw] overflow-y-auto border-r border-border bg-surface">
            <div className="flex h-16 items-center justify-between border-b border-border px-4">
              <Logo product="Developers" />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-surface-2">
                ✕
              </button>
            </div>
            <nav aria-label="Primary (mobile)" className="flex flex-wrap gap-2 border-b border-border px-4 py-3 md:hidden">
              {TOP_LINKS.slice(1).map((l) => (
                <Link key={l.href} href={l.href} className="rounded-md border border-border px-3 py-2 text-sm text-fg">
                  {l.label}
                </Link>
              ))}
            </nav>
            <SideNav pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <div className="mx-auto flex max-w-[90rem]">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 overflow-y-auto border-r border-border lg:block">
          <SideNav pathname={pathname} />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
