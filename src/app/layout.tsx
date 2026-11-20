import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import { Providers } from '@/components/providers';
import { isStaging } from '@/lib/env';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#1F3864',
};

export const metadata: Metadata = {
  title: {
    default: 'Ace Holdings POS',
    template: '%s | Ace Holdings POS',
  },
  description:
    'Stock management, sales and point-of-sale system for Ace Holdings Limited, Blantyre, Malawi.',
  icons: {
    icon: '/brand/ace-logo.png',
    apple: '/brand/ace-logo.png',
  },
  robots: { index: false, follow: false }, // internal system — no public indexing
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const showStagingBanner = isStaging();

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>
        {showStagingBanner && (
          <div
            id="staging-banner"
            className="w-full bg-amber-400 text-amber-950 py-1.5 px-4 text-center text-xs font-black uppercase tracking-wider border-b border-amber-500 sticky top-0 z-50 shadow-sm"
          >
            ⚠️ STAGING ENVIRONMENT — TEST DATA ONLY — NOT A REAL SYSTEM
          </div>
        )}
        <Providers>
          {children}
        </Providers>
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}

