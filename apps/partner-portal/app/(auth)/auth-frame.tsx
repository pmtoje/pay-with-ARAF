'use client';

import type { ReactNode } from 'react';
import { Logo, ThemeToggle } from '@araf/ui';

/** Centered frame for sign-in and invitation screens. */
export function AuthFrame({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <Logo product="Partner" />
        <ThemeToggle />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">
          <div className="rounded-lg border border-border bg-surface px-6 py-7 sm:px-8">
            <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
            {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="mt-4 text-center text-xs text-subtle">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
