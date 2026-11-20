import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { CookieBanner } from '../components/landing/CookieBanner';
import { metrikaId } from '../lib/analytics';
import { THEME_COOKIE, themeOf } from '../lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Блоккер — собери что угодно из блоков',
  description: 'Конструктор интерактивных открыток, тестов, квизов и своих мини-игр. Поделись ссылкой или QR-кодом.',
  // Closed from search until the launch; the owner opens it with SITE_INDEXABLE=1 (P10.1).
  robots: process.env.SITE_INDEXABLE === '1' ? { index: true, follow: true } : { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/** Every page is made per request: the nonce of the policy (proxy.ts) is different each time, so a page made in advance could not carry it. */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  // The chosen look comes with the page itself (no flash of the other colours): `data-theme` beats the system setting.
  const theme = themeOf((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="ru" {...(theme === 'system' ? {} : { 'data-theme': theme })}>
      <body>
        {children}
        <CookieBanner metrikaId={metrikaId(process.env.YANDEX_METRIKA_ID)} />
      </body>
    </html>
  );
}
