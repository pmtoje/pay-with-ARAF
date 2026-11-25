import Link from 'next/link';

/** AltMall wordmark — a fictional demo-store identity (not The Alternative Bank's branding). */
export function AltMallLogo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="fill-mall" />
        <path d="M9 12h14l-1.4 12.2a1.6 1.6 0 0 1-1.6 1.4h-8a1.6 1.6 0 0 1-1.6-1.4z" fill="none" strokeWidth="2" strokeLinejoin="round" className="stroke-mall-contrast" />
        <path d="M12.5 12V10a3.5 3.5 0 0 1 7 0v2" fill="none" strokeWidth="2" strokeLinecap="round" className="stroke-mall-contrast" />
      </svg>
      <span className="text-[19px] font-semibold tracking-tight text-fg">
        Alt<span className="text-mall">Mall</span>
      </span>
    </span>
  );
}

/** Small "Pay with ARAF" lockup used next to the payment option. */
export function PayWithArafMark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-5 w-5' : 'h-7 w-7';
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-hidden="true">
        <rect width="32" height="32" rx="7" className="fill-ink" />
        <path d="M8 23V15a8 8 0 0 1 16 0v8" fill="none" strokeWidth="2.6" strokeLinecap="round" className="stroke-gold" />
        <path d="M12.5 23v-7a3.5 3.5 0 0 1 7 0v7" fill="none" strokeWidth="2.2" strokeLinecap="round" className="stroke-ink-contrast" />
      </svg>
      <span className={size === 'sm' ? 'text-sm font-semibold' : 'font-semibold'}>
        Pay with <span className="text-gold-strong">ARAF</span>
      </span>
    </span>
  );
}

export function HomeLink() {
  return (
    <Link href="/" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" aria-label="AltMall home">
      <AltMallLogo />
    </Link>
  );
}
