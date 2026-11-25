'use client';

import { useEffect, useId, useState } from 'react';
import { cn } from '@araf/ui';
import { highlight, type Lang } from '@/lib/highlight';

const LANG_KEY = 'araf-docs-lang';
const LANG_EVENT = 'araf-docs-lang-change';

export function CopyCode({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className={cn('inline-flex h-8 items-center rounded-md border border-white/15 px-2.5 text-xs font-medium text-[#ece9e2] transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d6b25c]', className)}
      aria-label={copied ? 'Copied to clipboard' : 'Copy code'}
    >
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

export function CodeBlock({ code, lang = 'text', title, className, maxHeight }: { code: string; lang?: Lang; title?: string; className?: string; maxHeight?: string }) {
  const trimmed = code.replace(/^\n+|\s+$/g, '');
  return (
    <figure className={cn('code-panel my-5 overflow-hidden rounded-lg border border-black/40', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
        <figcaption className="truncate font-mono text-xs text-[#b8b3a8]">{title ?? lang}</figcaption>
        <CopyCode value={trimmed} />
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-[13px] leading-6" style={maxHeight ? { maxHeight } : undefined} tabIndex={0}>
        <code className="font-mono">{highlight(trimmed, lang)}</code>
      </pre>
    </figure>
  );
}

export interface CodeTab {
  label: string;
  lang: Lang;
  code: string;
  title?: string;
}

/** Language tabs; the chosen language is remembered (per browser) and synced across the page. */
export function CodeTabs({ tabs, className }: { tabs: CodeTab[]; className?: string }) {
  const id = useId();
  const [active, setActive] = useState(tabs[0]?.label);
  useEffect(() => {
    const apply = (lang: string | null) => {
      if (lang && tabs.some((t) => t.label === lang)) setActive(lang);
    };
    try {
      apply(localStorage.getItem(LANG_KEY));
    } catch {
      /* storage unavailable */
    }
    const onChange = (e: Event) => apply((e as CustomEvent<string>).detail);
    window.addEventListener(LANG_EVENT, onChange);
    return () => window.removeEventListener(LANG_EVENT, onChange);
  }, [tabs]);
  const choose = (label: string) => {
    setActive(label);
    try {
      localStorage.setItem(LANG_KEY, label);
    } catch {
      /* storage unavailable */
    }
    window.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: label }));
  };
  const current = tabs.find((t) => t.label === active) ?? tabs[0];
  const trimmed = current.code.replace(/^\n+|\s+$/g, '');
  return (
    <div className={cn('code-panel my-5 overflow-hidden rounded-lg border border-black/40', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-white/10 pl-2 pr-3">
        <div role="tablist" aria-label="Code language" className="flex overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.label}
              role="tab"
              type="button"
              id={`${id}-${t.label}`}
              aria-selected={t.label === current.label}
              aria-controls={`${id}-panel`}
              onClick={() => choose(t.label)}
              onKeyDown={(e) => {
                const i = tabs.findIndex((x) => x.label === t.label);
                if (e.key === 'ArrowRight') choose(tabs[(i + 1) % tabs.length].label);
                if (e.key === 'ArrowLeft') choose(tabs[(i - 1 + tabs.length) % tabs.length].label);
              }}
              className={cn(
                '-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#d6b25c]',
                t.label === current.label ? 'border-[#d6b25c] text-white' : 'border-transparent text-[#b8b3a8] hover:text-white',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <CopyCode value={trimmed} />
      </div>
      {current.title && <p className="border-b border-white/10 px-4 py-1.5 font-mono text-xs text-[#b8b3a8]">{current.title}</p>}
      <pre id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${current.label}`} tabIndex={0} className="overflow-x-auto px-4 py-4 text-[13px] leading-6">
        <code className="font-mono">{highlight(trimmed, current.lang)}</code>
      </pre>
    </div>
  );
}
