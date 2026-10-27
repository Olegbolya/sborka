import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Player } from '../../../components/play/Player';
import { StateScreen } from '../../../components/play/StateScreen';
import { playMediaUrl } from '../../../lib/play/api';
import { loadPlayView, siteOrigin } from '../../../lib/play/server';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const view = await loadPlayView(slug);
  if (!view) return { title: 'Недоступно — Блокум', robots: { index: false, follow: false } };
  const origin = await siteOrigin();
  const title = view.title;
  // PL-05: nothing is indexed unless the creator on a paid tariff allows it.
  const indexable = view.state === 'ok' && view.indexable;
  if (view.state !== 'ok') return { title, robots: { index: false, follow: false } };
  const image = view.ogImageId ? `${origin}${playMediaUrl(slug, view.ogImageId)}` : null;
  return {
    title,
    ...(view.description ? { description: view.description } : {}),
    robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title, ...(view.description ? { description: view.description } : {}), type: 'website', url: `${origin}/s/${slug}`, siteName: 'Блокум', locale: 'ru_RU', ...(image ? { images: [{ url: image }] } : {}) },
    twitter: { card: image ? 'summary_large_image' : 'summary', title, ...(view.description ? { description: view.description } : {}), ...(image ? { images: [image] } : {}) },
  };
}

/** PL-01, PL-03 · the page of a published project: the first screen is made on the server. */
export default async function PlayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await loadPlayView(slug);
  if (!view) notFound();
  if (view.state !== 'ok') return <StateScreen theme={view.theme} title={view.title} text={view.text} />;
  return <Player view={view} />;
}
