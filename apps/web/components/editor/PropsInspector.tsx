'use client';
import { type Block } from '@blokum/schema';
import { PROP_SPECS } from '../../lib/editor/props-specs';
import { setBlockProps } from '../../lib/editor/commands';
import { useEditor } from './context';
import { Fields, type Level } from './StylePanels';

/** B-01…B-23 · what is set in the blocks of one type (the table of `props-specs.ts`); blocks of different types share nothing here. */
export function PropsInspector({ blocks }: { blocks: Block[] }) {
  const apply = useEditor((s) => s.apply);
  const tokens = useEditor((s) => s.doc.theme.tokens);
  const type = blocks[0]!.type;
  if (!blocks.every((b) => b.type === type))
    return <p className="ed-hint">Выбраны блоки разных видов: общие свойства — на вкладке «Оформление».</p>;
  const spec = PROP_SPECS[type];
  if (spec.fields.length === 0) return null;
  const ids = blocks.map((b) => b.id);
  const level: Level = {
    values: blocks.map((b) => b.props),
    ids,
    write: (change) =>
      apply(setBlockProps(ids, change), { label: 'Свойства блока', mergeKey: `props:${ids.join(',')}` }),
    tokens,
  };
  return (
    <div className="ed-section" data-testid="props-inspector" data-block-type={type}>
      <h2>Свойства</h2>
      <Fields fields={spec.fields} level={level} prefix="props" />
    </div>
  );
}
