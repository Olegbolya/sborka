import { BuildFromTemplate } from '../../../../components/wizard/BuildFromTemplate';

export const metadata = { title: 'Собираем такую же — Блоккер', robots: { index: false, follow: false } };

export default async function BuildPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ src?: string }> }) {
  const { slug } = await params;
  const { src } = await searchParams;
  return <BuildFromTemplate slug={slug} source={src ?? ''} />;
}
