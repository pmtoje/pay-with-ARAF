import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { FLAT_NAV } from '@/lib/nav';

export function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Standard documentation page: title, lede, content, on-page contents, previous/next. */
export function DocPage({ path, eyebrow, title, lede, toc = [], children, wide }: { path: string; eyebrow?: string; title: string; lede?: ReactNode; toc?: string[]; children: ReactNode; wide?: boolean }) {
  const idx = FLAT_NAV.findIndex((n) => n.href === path);
  const prev = idx > 0 ? FLAT_NAV[idx - 1] : null;
  const next = idx >= 0 && idx < FLAT_NAV.length - 1 ? FLAT_NAV[idx + 1] : null;
  return (
    <div className="flex">
      <main id="main" className={cn('min-w-0 flex-1 px-4 py-10 sm:px-8 lg:px-12', wide ? 'max-w-6xl' : 'max-w-4xl')}>
        {eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-gold-strong">{eyebrow}</p>}
        <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{title}</h1>
        {lede && <p className="mt-3 max-w-3xl text-lg leading-8 text-muted">{lede}</p>}
        <div className="doc-prose mt-8">{children}</div>
        {(prev || next) && (
          <nav aria-label="Previous and next pages" className="mt-16 grid gap-3 border-t border-border pt-6 sm:grid-cols-2">
            {prev ? (
              <Link href={prev.href} className="group rounded-lg border border-border px-4 py-3 hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                <span className="block text-xs text-subtle">Previous</span>
                <span className="font-medium text-fg group-hover:text-gold-strong">← {prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link href={next.href} className="group rounded-lg border border-border px-4 py-3 text-right hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                <span className="block text-xs text-subtle">Next</span>
                <span className="font-medium text-fg group-hover:text-gold-strong">{next.title} →</span>
              </Link>
            )}
          </nav>
        )}
      </main>
      {toc.length > 0 && (
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-56 shrink-0 overflow-y-auto py-10 pr-6 xl:block">
          <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-subtle">On this page</p>
          <ul className="mt-3 space-y-2 border-l border-border text-sm">
            {toc.map((t) => (
              <li key={t}>
                <a href={`#${slug(t)}`} className="-ml-px block border-l border-transparent pl-3 text-muted hover:border-gold hover:text-fg">
                  {t}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}

export function H2({ children, id }: { children: string; id?: string }) {
  const anchor = id ?? slug(children);
  return (
    <h2 id={anchor} className="group mb-3 mt-12 scroll-mt-24 border-t border-border pt-8 text-2xl font-semibold tracking-tight text-fg first:mt-0 first:border-0 first:pt-0">
      {children}
      <a href={`#${anchor}`} className="no-underline ml-2 text-subtle opacity-0 transition-opacity hover:text-gold-strong group-hover:opacity-100 focus:opacity-100" aria-label={`Link to ${children}`}>
        #
      </a>
    </h2>
  );
}

export function H3({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="mb-2 mt-8 scroll-mt-24 text-lg font-semibold text-fg">
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="my-4">{children}</p>;
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warning' | 'danger' | 'success' | 'gold'; title?: string; children: ReactNode }) {
  const styles = {
    info: 'border-info/40 bg-info-soft',
    warning: 'border-warning/40 bg-warning-soft',
    danger: 'border-danger/50 bg-danger-soft',
    success: 'border-success/40 bg-success-soft',
    gold: 'border-gold/50 bg-gold-soft',
  }[tone];
  const titleColor = { info: 'text-info', warning: 'text-warning', danger: 'text-danger', success: 'text-success', gold: 'text-gold-strong' }[tone];
  return (
    <div role="note" className={cn('my-6 rounded-md border-l-4 px-4 py-3 text-[15px]', styles)}>
      {title && <p className={cn('mb-1 font-semibold', titleColor)}>{title}</p>}
      <div className="text-fg/90 [&>p]:my-1">{children}</div>
    </div>
  );
}

const METHOD_TONE: Record<string, string> = {
  GET: 'bg-info-soft text-info',
  POST: 'bg-success-soft text-success',
};

export function Endpoint({ method, path, scope }: { method: 'GET' | 'POST'; path: string; scope?: string }) {
  return (
    <div className="my-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2.5">
      <span className={cn('rounded-sm px-2 py-0.5 font-mono text-xs font-bold', METHOD_TONE[method])}>{method}</span>
      <code className="!border-0 !bg-transparent !p-0 font-mono text-sm text-fg">{path}</code>
      {scope && (
        <span className="ml-auto text-xs text-muted">
          scope <code>{scope}</code>
        </span>
      )}
    </div>
  );
}

export interface Param {
  name: string;
  type: string;
  required?: boolean;
  description: ReactNode;
}

export function ParamTable({ params, caption }: { params: Param[]; caption?: string }) {
  // Definition list: two columns on wide screens, stacked on phones (no horizontal scrolling).
  return (
    <dl aria-label={caption} className="my-5 divide-y divide-border overflow-hidden rounded-lg border border-border">
      <div className="hidden bg-surface-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-subtle sm:grid sm:grid-cols-[minmax(11rem,16rem)_1fr] sm:gap-4" aria-hidden="true">
        <span>Field</span>
        <span>Description</span>
      </div>
      {params.map((p) => (
        <div key={p.name} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(11rem,16rem)_1fr] sm:gap-4">
          <dt className="min-w-0">
            <code className="!border-0 !bg-transparent !p-0 break-all font-mono text-[13px] font-semibold text-fg">{p.name}</code>
            <div className="mt-0.5 text-xs text-muted">
              {p.type}
              {p.required ? <span className="ml-1.5 font-semibold text-danger">required</span> : <span className="ml-1.5 text-subtle">optional</span>}
            </div>
          </dt>
          <dd className="min-w-0 text-fg/90">{p.description}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SimpleTable({ head, rows, caption, mono = [0] }: { head: string[]; rows: ReactNode[][]; caption?: string; mono?: number[] }) {
  return (
    <div className="my-5 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-surface-2">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-subtle">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border align-top">
              {r.map((c, j) => (
                <td key={j} className={cn('px-4 py-2.5 text-fg/90', mono.includes(j) && 'font-mono text-[13px] font-medium text-fg')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Steps({ items }: { items: Array<{ title: string; body: ReactNode }> }) {
  return (
    <ol className="!list-none !space-y-0 !pl-0 my-6">
      {items.map((s, i) => (
        <li key={s.title} className="relative flex gap-4 pb-6 last:pb-0">
          {i < items.length - 1 && <span className="absolute left-[15px] top-9 h-[calc(100%-2.25rem)] w-px bg-border" aria-hidden="true" />}
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-ink-contrast">{i + 1}</span>
          <div className="min-w-0 pt-0.5">
            <p className="font-semibold text-fg">{s.title}</p>
            <div className="mt-1 text-fg/85">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
