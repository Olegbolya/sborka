import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { connection } from 'next/server';
import './globals.css';

export const metadata: Metadata = {
  title: 'Блокум — собери что угодно из блоков',
  description: 'Конструктор интерактивных открыток, тестов, квизов и своих мини-игр. Поделись ссылкой или QR-кодом.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/** Every page is made per request: the nonce of the policy (proxy.ts) is different each time, so a page made in advance could not carry it. */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
