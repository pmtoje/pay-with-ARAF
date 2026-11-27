'use client';

import { useEffect, useState } from 'react';
import { toString as qrToSvg } from 'qrcode';

/**
 * Authenticator set-up: a QR code to scan (generated in the browser from the otpauth URI — the secret
 * never leaves the page) and, for set-up on the same phone, a button that opens the authenticator app.
 */
export function TotpQr({ uri, className = '' }: { uri: string; className?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    qrToSvg(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0c0c0d', light: '#ffffff' } })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(null));
    return () => {
      live = false;
    };
  }, [uri]);
  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div className="h-48 w-48 rounded-md border border-border bg-white p-2" role="img" aria-label="QR code to scan with your authenticator app">
        {svg ? <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} /> : null}
      </div>
      <p className="text-center text-xs text-muted">Scan with Google Authenticator, Microsoft Authenticator or Authy.</p>
      <a
        href={uri}
        className="inline-flex h-10 items-center justify-center rounded-md border border-border-strong px-4 text-sm font-medium text-fg hover:bg-surface-2 md:hidden"
      >
        On this phone? Open in authenticator app
      </a>
    </div>
  );
}
