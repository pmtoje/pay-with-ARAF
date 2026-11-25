import type { ReactNode } from 'react';

/**
 * Tiny dependency-free syntax highlighter for documentation snippets. It only colours
 * comments, strings, numbers, keywords and JSON keys — enough for readability.
 */
export type Lang = 'javascript' | 'typescript' | 'python' | 'php' | 'bash' | 'json' | 'http' | 'text';

const KEYWORDS: Record<string, string[]> = {
  javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'await', 'async', 'import', 'from', 'export', 'new', 'throw', 'try', 'catch', 'for', 'of', 'in', 'true', 'false', 'null', 'undefined', 'require', 'typeof'],
  typescript: ['const', 'let', 'function', 'return', 'if', 'else', 'await', 'async', 'import', 'from', 'export', 'new', 'throw', 'try', 'catch', 'for', 'of', 'in', 'true', 'false', 'null', 'undefined', 'type', 'interface', 'as', 'string', 'number', 'boolean', 'void', 'Promise'],
  python: ['import', 'from', 'def', 'return', 'if', 'elif', 'else', 'not', 'and', 'or', 'in', 'for', 'True', 'False', 'None', 'raise', 'try', 'except', 'with', 'as', 'is', 'lambda'],
  php: ['function', 'return', 'if', 'else', 'foreach', 'as', 'true', 'false', 'null', 'throw', 'new', 'try', 'catch', 'echo', 'exit', 'use', 'fn'],
  bash: ['curl', 'export', 'echo'],
  json: ['true', 'false', 'null'],
  http: ['GET', 'POST'],
  text: [],
};

export function highlight(code: string, lang: Lang): ReactNode[] {
  if (lang === 'text') return [code];
  const hashComments = lang === 'python' || lang === 'bash' || lang === 'php';
  const slashComments = lang !== 'python' && lang !== 'bash' && lang !== 'json' && lang !== 'http';
  const parts = [
    slashComments ? String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/` : null,
    hashComments ? String.raw`(?:^|(?<=\s))#[^\n]*` : null,
    String.raw`"(?:[^"\\\n]|\\.)*"(?:\s*(?=:))?`,
    String.raw`'(?:[^'\\\n]|\\.)*'`,
    lang === 'javascript' || lang === 'typescript' ? String.raw`\`(?:[^\`\\]|\\.)*\`` : null,
    String.raw`\b\d+(?:\.\d+)?\b`,
    String.raw`\b[A-Za-z_$][\w$]*\b`,
  ].filter(Boolean);
  const re = new RegExp(parts.join('|'), 'gm');
  const kws = new Set(KEYWORDS[lang] ?? []);
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of code.matchAll(re)) {
    const tok = m[0];
    const idx = m.index ?? 0;
    if (idx > last) out.push(code.slice(last, idx));
    let cls: string | null = null;
    if (tok.startsWith('//') || tok.startsWith('/*') || tok.startsWith('#')) cls = 'tok-com';
    else if (tok.startsWith('"')) cls = lang === 'json' && code.slice(idx + tok.length).match(/^\s*:/) ? 'tok-key' : 'tok-str';
    else if (tok.startsWith("'") || tok.startsWith('`')) cls = 'tok-str';
    else if (/^\d/.test(tok)) cls = 'tok-num';
    else if (kws.has(tok)) cls = 'tok-kw';
    else if (code[idx + tok.length] === '(' && lang !== 'json') cls = 'tok-fn';
    out.push(cls ? <span key={i++} className={cls}>{tok}</span> : tok);
    last = idx + tok.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}
