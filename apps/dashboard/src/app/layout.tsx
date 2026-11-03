import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { AppShell } from '@/components/app-shell';
import { Providers } from '@/components/providers';
import './globals.css';

const inter = localFont({
  src: [
    { path: '../fonts/inter-latin-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/inter-latin-500.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-sans',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

const spaceGrotesk = localFont({
  src: [{ path: '../fonts/space-grotesk-latin-600.woff2', weight: '600', style: 'normal' }],
  variable: '--font-heading',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

const jetbrainsMono = localFont({
  src: [
    { path: '../fonts/jetbrains-mono-latin-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/jetbrains-mono-latin-500.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-mono',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

export const metadata: Metadata = {
  title: { default: 'Sana Guard', template: '%s · Sana Guard' },
  description: 'Owner console for policy-enforced AI agent wallets',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} font-sans`}
      >
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
