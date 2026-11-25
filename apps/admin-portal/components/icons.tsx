import type { ReactNode } from 'react';

function I({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'h-4 w-4'} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const Icon = {
  overview: (c?: string) => <I className={c}><path d="M4 13h6V4H4zM14 20h6V11h-6zM4 20h6v-4H4zM14 7h6V4h-6z" /></I>,
  approvals: (c?: string) => <I className={c}><path d="M9 11l2 2 4-4" /><path d="M5 4h14v16H5z" /></I>,
  partners: (c?: string) => <I className={c}><path d="M3 21V8l9-5 9 5v13" /><path d="M9 21v-6h6v6" /></I>,
  applications: (c?: string) => <I className={c}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></I>,
  reviews: (c?: string) => <I className={c}><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.3-4.3" /></I>,
  araf: (c?: string) => <I className={c}><path d="M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v5h-4z" /></I>,
  policy: (c?: string) => <I className={c}><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></I>,
  operations: (c?: string) => <I className={c}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /></I>,
  reconcile: (c?: string) => <I className={c}><path d="M4 7h13l-3-3M20 17H7l3 3" /></I>,
  reports: (c?: string) => <I className={c}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></I>,
  audit: (c?: string) => <I className={c}><path d="M12 8v4l3 2" /><circle cx="12" cy="12" r="9" /></I>,
  users: (c?: string) => <I className={c}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 010 7M18.5 14.8c1.6.9 2.6 2.6 3 5.2" /></I>,
  integrations: (c?: string) => <I className={c}><path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 01-10 0zM12 16v5" /></I>,
  sandbox: (c?: string) => <I className={c}><path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 006 21h12a1.7 1.7 0 001.5-2.5L14 9V3" /><path d="M7 15h10" /></I>,
  bell: (c?: string) => <I className={c}><path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10.3 21a1.9 1.9 0 003.4 0" /></I>,
  check: (c?: string) => <I className={c}><path d="M5 12l5 5L20 7" /></I>,
  x: (c?: string) => <I className={c}><path d="M6 6l12 12M18 6L6 18" /></I>,
  lock: (c?: string) => <I className={c}><rect x="5" y="11" width="14" height="10" rx="1.5" /><path d="M8 11V7a4 4 0 018 0v4" /></I>,
  external: (c?: string) => <I className={c}><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" /></I>,
  download: (c?: string) => <I className={c}><path d="M12 4v11M7 10l5 5 5-5M4 20h16" /></I>,
  chevron: (c?: string) => <I className={c}><path d="M9 6l6 6-6 6" /></I>,
  back: (c?: string) => <I className={c}><path d="M15 6l-6 6 6 6" /></I>,
  refresh: (c?: string) => <I className={c}><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" /></I>,
  plus: (c?: string) => <I className={c}><path d="M12 5v14M5 12h14" /></I>,
  dot: (c?: string) => <svg viewBox="0 0 8 8" className={c ?? 'h-2 w-2'} aria-hidden="true"><circle cx="4" cy="4" r="4" fill="currentColor" /></svg>,
};
