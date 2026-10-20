import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { devPagesEnabled } from '../../../lib/dev/dev-pages';
import { DevArtboard } from './DevArtboard';

export const metadata: Metadata = { title: 'Проверка артборда — Блокум' };
// The switch BLOKUM_DEV_PAGES is read on every request, not at build time.
export const dynamic = 'force-dynamic';

export default async function DevArtboardPage({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  if (!devPagesEnabled()) notFound();
  const { theme } = await searchParams;
  return <DevArtboard theme={theme === 'dark' ? 'dark' : 'light'} />;
}
