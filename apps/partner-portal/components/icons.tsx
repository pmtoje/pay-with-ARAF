/** Minimal line icons (24px grid, currentColor). Decorative: always aria-hidden. */
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, className: 'h-4 w-4' };

export const IconOverview = () => (
  <svg {...base}>
    <path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z" />
  </svg>
);
export const IconApplications = () => (
  <svg {...base}>
    <path d="M7 3h7l5 5v13H7z" />
    <path d="M14 3v5h5M10 13h6M10 17h6" />
  </svg>
);
export const IconRelease = () => (
  <svg {...base}>
    <path d="M3 7l9-4 9 4-9 4z" />
    <path d="M3 7v10l9 4 9-4V7M12 11v10" />
  </svg>
);
export const IconSettlements = () => (
  <svg {...base}>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 10h18M7 15h4" />
  </svg>
);
export const IconIntegration = () => (
  <svg {...base}>
    <path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13.5 6l-3 12" />
  </svg>
);
export const IconTeam = () => (
  <svg {...base}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20a6 6 0 0 1 12 0M16 4.5a3 3 0 0 1 0 6M18 14.5a5.5 5.5 0 0 1 3 5.5" />
  </svg>
);
export const IconShield = () => (
  <svg {...base}>
    <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />
  </svg>
);
export const IconBell = () => (
  <svg {...base} className="h-[18px] w-[18px]">
    <path d="M6 10a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 15 6 10zM10 20a2 2 0 0 0 4 0" />
  </svg>
);
export const IconCheck = ({ className = 'h-6 w-6' }: { className?: string }) => (
  <svg {...base} className={className} strokeWidth={2.4}>
    <path d="M4.5 12.5l5 5 10-11" />
  </svg>
);
export const IconStop = ({ className = 'h-6 w-6' }: { className?: string }) => (
  <svg {...base} className={className} strokeWidth={2.4}>
    <circle cx="12" cy="12" r="9" />
    <path d="M6 6l12 12" />
  </svg>
);
export const IconDownload = () => (
  <svg {...base}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);
