import { ThemeEditor } from '../../../../../components/themes/ThemeEditor';

export const metadata = { title: 'Редактор темы — Блокум' };

export default async function ThemeEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ThemeEditor themeId={id} />;
}
