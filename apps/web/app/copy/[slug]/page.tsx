import { CopyProject } from '../../../components/wizard/CopyProject';

export const metadata = { title: 'Копируем сборку — Блоккер', robots: { index: false, follow: false } };

export default async function CopyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CopyProject slug={slug} />;
}
