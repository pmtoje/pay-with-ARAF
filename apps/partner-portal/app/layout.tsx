import type { Metadata, Viewport } from 'next';
import { themeInitScript } from '@araf/ui';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pay with ARAF — Partner portal',
  description: 'Pay with ARAF — embedded non-interest financing by The Alternative Bank (sandbox build).',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0C0C0D' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
