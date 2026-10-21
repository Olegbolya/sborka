import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { devPagesEnabled } from '../../../lib/dev/dev-pages';
import { DevAnimations } from './DevAnimations';

export const metadata: Metadata = { title: 'Галерея анимаций — Блокум' };
export const dynamic = 'force-dynamic';

export default async function DevAnimationsPage({ searchParams }: { searchParams: Promise<{ theme?: string; part?: string }> }) {
  if (!devPagesEnabled()) notFound();
  const { theme, part } = await searchParams;
  const only = part === 'blocks' || part === 'transitions' || part === 'particles' ? part : undefined;
  return <DevAnimations theme={theme === 'dark' ? 'dark' : 'light'} {...(only ? { only } : {})} />;
}
