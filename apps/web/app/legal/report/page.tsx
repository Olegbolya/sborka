import { ComplaintForm } from '../../../components/legal/LegalForms';

export const metadata = { title: 'Пожаловаться на сборку — Блоккер' };

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ slug?: string }> }) {
  const { slug } = await searchParams;
  return <ComplaintForm initialSlug={typeof slug === 'string' ? slug : ''} />;
}
