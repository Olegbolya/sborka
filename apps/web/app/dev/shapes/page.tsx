import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { devPagesEnabled } from '../../../lib/dev/dev-pages';
import { DevShapes } from './DevShapes';

export const metadata: Metadata = { title: 'Галерея форм — Блокум' };
export const dynamic = 'force-dynamic';

export default async function DevShapesPage({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  if (!devPagesEnabled()) notFound();
  const { theme } = await searchParams;
  return <DevShapes theme={theme === 'dark' ? 'dark' : 'light'} />;
}
