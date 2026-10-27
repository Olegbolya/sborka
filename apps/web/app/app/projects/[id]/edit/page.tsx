import { Editor } from '../../../../../components/editor/Editor';

export const metadata = { title: 'Редактор — Блокум' };

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Editor projectId={id} />;
}
