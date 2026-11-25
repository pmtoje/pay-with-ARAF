import type { ReactNode } from 'react';
import { Logo, SandboxBanner, ThemeToggle } from '@araf/ui';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SandboxBanner note="Bank administration portal" />
      <header className="flex h-16 items-center justify-between px-5 sm:px-8">
        <Logo product="Bank admin" />
        <ThemeToggle />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-[26rem]">{children}</div>
      </main>
      <footer className="px-5 pb-6 text-center text-2xs text-subtle sm:px-8">
        Restricted system. Access is limited to authorised Alternative Bank staff and every action is audited.
      </footer>
    </div>
  );
}
