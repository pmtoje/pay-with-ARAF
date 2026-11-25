import type { ArtKind } from '@/lib/catalogue';

/**
 * In-house product illustrations (inline SVG line-art). No third-party or brand imagery is used.
 * Strokes use the text colour; a single soft accent fill varies by `tone` so items in a grid differ.
 */
export function ProductArt({ kind, tone = 0, className, title }: { kind: ArtKind; tone?: 0 | 1 | 2; className?: string; title?: string }) {
  const accent = { fill: `rgb(var(--art-${tone}))` };
  const line = { fill: 'none', stroke: 'rgb(var(--art-line))', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const thin = { ...line, strokeWidth: 1.6 };
  const solid = { fill: 'rgb(var(--art-line))' };
  return (
    <svg viewBox="0 0 240 180" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <line x1="24" y1="166" x2="216" y2="166" style={{ ...thin, strokeOpacity: 0.35 }} />
      {kind === 'phone' && (
        <g>
          <rect x="86" y="14" width="68" height="144" rx="14" style={line} />
          <rect x="93" y="24" width="54" height="122" rx="7" style={accent} />
          <circle cx="120" cy="20" r="1.8" style={solid} />
          <circle cx="120" cy="72" r={tone === 2 ? 16 : 20} style={{ ...thin, strokeOpacity: 0.6 }} />
          <path d="M100 118c8-10 16-10 24 0s16 10 24 0" style={{ ...thin, strokeOpacity: 0.6 }} />
          {tone === 0 && <rect x="64" y="44" width="16" height="30" rx="5" style={{ ...thin, strokeOpacity: 0.5 }} />}
          {tone === 0 && <circle cx="72" cy="53" r="3.5" style={thin} />}
          {tone === 0 && <circle cx="72" cy="65" r="3.5" style={thin} />}
        </g>
      )}
      {kind === 'laptop' && (
        <g>
          <rect x="52" y="30" width="136" height="92" rx="7" style={line} />
          <rect x="60" y="38" width="120" height="76" rx="3" style={accent} />
          <path d="M28 132h184l-10 16H38z" style={line} />
          <line x1="104" y1="139" x2="136" y2="139" style={thin} />
          {tone === 2 ? <path d="M78 98l22-24 16 14 22-26 18 20" style={{ ...thin, strokeOpacity: 0.7 }} /> : <rect x="74" y="54" width="52" height="8" rx="2" style={{ ...solid, opacity: 0.25 }} />}
          {tone !== 2 && <rect x="74" y="70" width="88" height="6" rx="2" style={{ ...solid, opacity: 0.15 }} />}
          {tone !== 2 && <rect x="74" y="82" width="70" height="6" rx="2" style={{ ...solid, opacity: 0.15 }} />}
        </g>
      )}
      {kind === 'tv' && (
        <g>
          <rect x="22" y="22" width="196" height="116" rx="6" style={line} />
          <rect x="29" y="29" width="182" height="102" rx="2" style={accent} />
          <path d="M44 116l40-38 28 24 34-40 50 54" style={{ ...thin, strokeOpacity: 0.55 }} />
          <circle cx="170" cy="56" r="10" style={{ ...thin, strokeOpacity: 0.55 }} />
          {tone === 1 ? (
            <path d="M96 166l10-28M144 166l-10-28" style={line} />
          ) : (
            <>
              <path d="M58 166l8-28M182 166l-8-28" style={line} />
            </>
          )}
        </g>
      )}
      {kind === 'fridge' && (
        <g>
          {tone === 1 ? (
            <>
              <rect x="62" y="10" width="116" height="152" rx="8" style={line} />
              <rect x="66" y="14" width="52" height="144" rx="5" style={accent} />
              <line x1="120" y1="12" x2="120" y2="160" style={line} />
              <line x1="112" y1="60" x2="112" y2="108" style={line} />
              <line x1="128" y1="60" x2="128" y2="108" style={line} />
              <rect x="78" y="34" width="28" height="22" rx="3" style={thin} />
            </>
          ) : (
            <>
              <rect x="80" y="10" width="80" height="152" rx="8" style={line} />
              <rect x="84" y="14" width="72" height="42" rx="5" style={accent} />
              <line x1="80" y1="60" x2="160" y2="60" style={line} />
              <line x1="146" y1="26" x2="146" y2="46" style={line} />
              <line x1="146" y1="74" x2="146" y2="112" style={line} />
            </>
          )}
        </g>
      )}
      {kind === 'washer' && (
        <g>
          <rect x="66" y="14" width="108" height="148" rx="10" style={line} />
          <line x1="66" y1="44" x2="174" y2="44" style={line} />
          <circle cx="152" cy="29" r="6" style={thin} />
          <rect x="80" y="25" width="30" height="8" rx="2" style={{ ...solid, opacity: 0.25 }} />
          {tone === 1 ? (
            <>
              <rect x="80" y="62" width="80" height="80" rx="8" style={accent} />
              <rect x="80" y="62" width="80" height="80" rx="8" style={thin} />
              <line x1="100" y1="102" x2="140" y2="102" style={thin} />
            </>
          ) : (
            <>
              <circle cx="120" cy="103" r="40" style={line} />
              <circle cx="120" cy="103" r="31" style={accent} />
              <path d="M98 108c8-8 16-8 22 0s14 8 22 0" style={{ ...thin, strokeOpacity: 0.6 }} />
            </>
          )}
        </g>
      )}
      {kind === 'sofa' && (
        <g>
          <rect x="44" y="56" width="152" height="52" rx="10" style={accent} />
          <rect x="44" y="56" width="152" height="52" rx="10" style={line} />
          <rect x="26" y="84" width="30" height="62" rx="9" style={line} />
          <rect x="184" y="84" width="30" height="62" rx="9" style={line} />
          <rect x="56" y="104" width="128" height="34" rx="6" style={line} />
          <line x1="99" y1="104" x2="99" y2="138" style={thin} />
          <line x1="141" y1="104" x2="141" y2="138" style={thin} />
          <path d="M40 146v14M200 146v14" style={line} />
        </g>
      )}
      {kind === 'chair' && (
        <g>
          <path d="M84 38c0-12 72-12 72 0l-6 72H90z" style={accent} />
          <path d="M84 38c0-12 72-12 72 0l-6 72H90z" style={line} />
          <rect x="74" y="102" width="92" height="26" rx="10" style={line} />
          <path d="M84 128l-8 34M156 128l8 34" style={line} />
        </g>
      )}
      {kind === 'bed' && (
        <g>
          <rect x="34" y="40" width="172" height="62" rx="10" style={accent} />
          <rect x="34" y="40" width="172" height="62" rx="10" style={line} />
          <rect x="24" y="100" width="192" height="34" rx="6" style={line} />
          <rect x="54" y="84" width="56" height="18" rx="8" style={thin} />
          <rect x="130" y="84" width="56" height="18" rx="8" style={thin} />
          <path d="M34 134v26M206 134v26" style={line} />
        </g>
      )}
      {kind === 'panel' && (
        <g>
          <circle cx="190" cy="34" r="14" style={accent} />
          <path d="M190 10v-4M190 62v-4M166 34h-4M218 34h-4" style={thin} />
          <path d="M42 70h132l-22 70H20z" style={accent} />
          <path d="M42 70h132l-22 70H20z" style={line} />
          <path d="M86 70l-22 70M130 70l-22 70M35 93.3h132M27.6 116.7h132" style={thin} />
          <path d="M96 140l-4 22M76 162h40" style={line} />
          {tone === 0 && <rect x="178" y="112" width="34" height="48" rx="5" style={line} />}
          {tone === 0 && <line x1="186" y1="124" x2="204" y2="124" style={thin} />}
        </g>
      )}
      {kind === 'inverter' && (
        <g>
          <rect x="52" y="34" width="70" height="104" rx="8" style={line} />
          <rect x="62" y="46" width="50" height="26" rx="3" style={accent} />
          <circle cx="74" cy="92" r="4" style={thin} />
          <circle cx="100" cy="92" r="4" style={thin} />
          <rect x="136" y="70" width="58" height="92" rx="7" style={accent} />
          <rect x="136" y="70" width="58" height="92" rx="7" style={line} />
          <path d="M156 62h18M165 96l-8 16h16l-8 16" style={line} />
          <path d="M87 138v16h49" style={thin} />
        </g>
      )}
    </svg>
  );
}
