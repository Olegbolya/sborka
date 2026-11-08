'use client';
import { type BlockType } from '@blokum/schema';
import { addBlock } from '../../lib/editor/commands';
import { useEditor } from './context';

/** Что чаще всего кладут на пустой экран: у каждого блока — понятное название и подсказка, зачем он. */
const FIRST_BLOCKS: Array<{ type: BlockType; title: string; hint: string }> = [
  { type: 'text', title: 'Текст', hint: 'Заголовок или абзац' },
  { type: 'singleChoice', title: 'Вопрос', hint: 'Один ответ из нескольких' },
  { type: 'button', title: 'Кнопка', hint: 'Перейти на следующий экран' },
];

/**
 * E-14 · подсказка на пустом экране: с чего начать. Показывается только в редакторе (не в предпросмотре и не в
 * опубликованной сборке) и исчезает, как только на экране появляется первый блок.
 */
export function EmptyScreenHint({ screenId }: { screenId: string }) {
  const apply = useEditor((s) => s.apply);
  const select = useEditor((s) => s.select);
  const add = (type: BlockType) => {
    let created: string[] = [];
    apply(addBlock(screenId, type, null, (ids) => (created = ids)), { label: 'Добавить блок' });
    if (created[0]) select(screenId, [created[0]]);
  };
  return (
    <div className="ed-empty" data-testid="empty-screen-hint">
      <p className="ed-empty-title">Экран пока пустой</p>
      <p className="ed-hint">Добавьте первый блок — его можно будет перетащить, изменить размер и оформить справа.</p>
      <div className="ed-empty-actions">
        {FIRST_BLOCKS.map((b) => (
          <button key={b.type} type="button" className="ed-btn" title={b.hint} onClick={() => add(b.type)}>
            + {b.title}
          </button>
        ))}
      </div>
      <p className="ed-hint">Остальные блоки (фото, видео, фигуры, таймер…) — на вкладке «Добавить» слева.</p>
    </div>
  );
}
