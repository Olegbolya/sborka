import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { devPagesEnabled } from '../../../lib/dev/dev-pages';
import { buildMatrixDocument } from '../../../lib/dev/matrix-gallery';
import { DevMatrix } from './DevMatrix';

export const metadata: Metadata = { title: 'Матрица свойств — Блокум' };
export const dynamic = 'force-dynamic';

/** The document is built on the server: nested blocks get random ids, so the client must not rebuild it. */
export default async function DevMatrixPage({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  if (!devPagesEnabled()) notFound();
  const { theme } = await searchParams;
  return <DevMatrix theme={theme === 'dark' ? 'dark' : 'light'} screens={buildMatrixDocument().screens} />;
}
