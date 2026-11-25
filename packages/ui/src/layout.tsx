'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { cn } from './primitives';

/**
 * Pay with ARAF wordmark. This is a neutral product wordmark created for the build — it is
 * NOT The Alternative Bank's official logo, which must be supplied by the Bank (DECISIONS.md D-004).
 */
export function Logo({ product, compact, className }: { product?: string; compact?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden="true">
        <rect width="32" height="32" rx="7" className="fill-ink" />
        <path d="M8 23V15a8 8 0 0 1 16 0v8" fill="none" strokeWidth="2.6" strokeLinecap="round" className="stroke-gold" />
        <path d="M12.5 23v-7a3.5 3.5 0 0 1 7 0v7" fill="none" strokeWidth="2.2" strokeLinecap="round" className="stroke-ink-contrast" />
      </svg>
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight text-fg">
            Pay with <span className="text-gold-strong">ARAF</span>
            {product && <span className="ml-1.5 font-normal text-muted">{product}</span>}
          </span>
          <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-subtle">The Alternative Bank</span>
        </span>
      )}
    </span>
  );
}

const THEME_KEY = 'araf-theme';

/** Inline script (render in <head>) that applies the saved/system theme before paint. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains('dark')), []);
  return (
    <button
      type="button"
      onClick={() => {
        const next = !dark;
        document.documentElement.classList.toggle('dark', next);
        try {
          localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
        } catch {
          /* storage unavailable */
        }
        setDark(next);
      }}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cn('inline-flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', className)}
    >
      {dark ? (
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

export interface NavItem {
  href: string;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
  section?: string;
}

/**
 * Enterprise application shell: persistent sidebar on desktop, drawer on mobile.
 * `renderLink` lets the host app supply its router-aware link component.
 */
export function AppShell({
  product,
  nav,
  activeHref,
  renderLink,
  topRight,
  banner,
  children,
}: {
  product: string;
  nav: NavItem[];
  activeHref: string;
  renderLink: (item: NavItem, className: string, children: ReactNode, onClick?: () => void) => ReactNode;
  topRight?: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const sections = [...new Set(nav.map((n) => n.section ?? ''))];
  const isActive = (href: string) => activeHref === href || (href !== '/' && activeHref.startsWith(`${href}/`));
  const navList = (
    <nav aria-label="Main" className="space-y-5 px-3 py-4">
      {sections.map((s) => (
        <div key={s || 'main'}>
          {s && <p className="mb-1 px-2 text-2xs font-semibold uppercase tracking-[0.14em] text-subtle">{s}</p>}
          <ul className="space-y-0.5">
            {nav
              .filter((n) => (n.section ?? '') === s)
              .map((n) => (
                <li key={n.href}>
                  {renderLink(
                    n,
                    cn(
                      'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                      isActive(n.href) ? 'bg-surface-2 font-medium text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
                    ),
                    <>
                      {n.icon && <span className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true">{n.icon}</span>}
                      <span className="flex-1 truncate">{n.label}</span>
                      {n.badge}
                    </>,
                    () => setOpen(false),
                  )}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </nav>
  );
  return (
    <div className="min-h-screen bg-bg">
      {banner}
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex">
          <div className="flex h-16 items-center border-b border-border px-5">
            <Logo product={product} />
          </div>
          <div className="flex-1 overflow-y-auto">{navList}</div>
        </aside>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
            <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-border bg-surface">
              <div className="flex h-16 items-center justify-between border-b border-border px-5">
                <Logo product={product} />
                <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation" className="rounded-md p-2 text-muted hover:bg-surface-2">
                  ✕
                </button>
              </div>
              {navList}
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur sm:px-6">
            <button type="button" onClick={() => setOpen(true)} className="rounded-md p-2 text-muted hover:bg-surface-2 lg:hidden" aria-label="Open navigation">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
              </svg>
            </button>
            <div className="lg:hidden">
              <Logo compact />
            </div>
            <div className="ml-auto flex items-center gap-2">{topRight}</div>
          </header>
          <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
