import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { devPagesEnabled } from '../../../lib/dev/dev-pages';
import { buildBehaviorScenes, buildPerfScene } from '../../../lib/dev/behaviors-gallery';
import { DevBehaviors } from './DevBehaviors';

export const metadata: Metadata = { title: 'Галерея поведений — Блокум' };
export const dynamic = 'force-dynamic';

export default async function DevBehaviorsPage({ searchParams }: { searchParams: Promise<{ theme?: string; part?: string }> }) {
  if (!devPagesEnabled()) notFound();
  const { theme, part } = await searchParams;
  const scenes = part === 'perf' ? [buildPerfScene()] : buildBehaviorScenes();
  return <DevBehaviors theme={theme === 'dark' ? 'dark' : 'light'} scenes={scenes} />;
}
