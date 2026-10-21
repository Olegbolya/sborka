import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { devPagesEnabled } from '../../../lib/dev/dev-pages';
import { buildRenderGallery } from '../../../lib/dev/render-gallery';
import { DevRenderGallery } from './DevRenderGallery';

export const metadata: Metadata = { title: 'Галерея блоков — Блокум' };
export const dynamic = 'force-dynamic';

export default async function DevRenderGalleryPage({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  if (!devPagesEnabled()) notFound();
  const { theme } = await searchParams;
  return <DevRenderGallery theme={theme === 'dark' ? 'dark' : 'light'} sections={buildRenderGallery()} />;
}
