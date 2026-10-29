'use client';
import { type Behavior } from '@blokum/schema';
import { useState } from 'react';
import { addBehavior, removeBehavior, setBehavior } from '../../lib/editor/rules';
import { BEHAVIORS, type MakeContext } from '../../lib/editor/scenario-specs';
import { SelectInput } from './controls';
import { useEditor } from './context';
import { PartForm } from './ScenarioForm';

/** BH-01…BH-08 · what the block does by itself: drags, runs away, spins… Each is a small form of its own. */
export function BehaviorsEditor({ blockId, behaviors }: { blockId: string; behaviors: readonly Behavior[] }) {
  const doc = useEditor((s) => s.doc);
  const apply = useEditor((s) => s.apply);
  const screenId = useEditor((s) => s.selection.screenId);
  const [open, setOpen] = useState<number | null>(null);
  const ctx: MakeContext = { doc, self: blockId, screenId };
  const free = BEHAVIORS.filter((b) => !behaviors.some((x) => x.kind === b.kind));
  return (
    <div className="ed-section" data-testid="behaviors-editor">
      <h2>Поведения</h2>
      <p className="ed-hint">То, что блок делает сам: тащится, убегает, переворачивается.</p>
      {behaviors.map((behavior, index) => {
        const spec = BEHAVIORS.find((b) => b.kind === behavior.kind)!;
        const isOpen = open === index;
        return (
          <div key={behavior.kind} className="ed-layer" data-behavior={behavior.kind}>
            <div className="ed-layerhead">
              <button type="button" className="ed-link" aria-expanded={isOpen} aria-label={`Поведение: ${spec.title}`} onClick={() => setOpen(isOpen ? null : index)}>
                {spec.title}
              </button>
              <button type="button" className="ed-btn small" aria-label={`Поведение «${spec.title}»: убрать`} onClick={() => apply(removeBehavior(blockId, index), { label: 'Убрать поведение' })}>
                ✕
              </button>
            </div>
            {isOpen && (
              <>
                <p className="ed-hint">{spec.hint}</p>
                <PartForm spec={spec} value={behavior} ctx={ctx} place={null} onChange={(v) => apply(setBehavior(blockId, index, v as unknown as Behavior), { label: `Поведение: ${spec.title}`, mergeKey: `behavior:${blockId}:${index}` })} />
              </>
            )}
          </div>
        );
      })}
      <SelectInput<string>
        control="add-behavior"
        label="Добавить поведение"
        value=""
        options={[['', behaviors.length >= 8 ? 'Больше восьми нельзя' : free.length === 0 ? 'Все поведения уже добавлены' : 'Добавить поведение…'], ...free.map((b) => [b.kind, b.title] as const)]}
        onChange={(kind) => {
          const spec = BEHAVIORS.find((b) => b.kind === kind);
          if (!spec || behaviors.length >= 8) return;
          apply(addBehavior(blockId, spec.make(ctx) as unknown as Behavior), { label: `Поведение: ${spec.title}` });
          setOpen(behaviors.length);
        }}
      />
    </div>
  );
}
