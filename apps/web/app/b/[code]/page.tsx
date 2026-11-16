import { BoardScreen } from '../../../components/board/BoardScreen';

/** D-17 · the public board: it is not indexed and has nothing of the passages but the standings. */
export const metadata = { title: 'Табло — Блоккер', robots: { index: false, follow: false } };

export default async function BoardPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <BoardScreen code={code} />;
}
