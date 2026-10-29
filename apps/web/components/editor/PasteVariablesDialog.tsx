'use client';
import { useState } from 'react';
import { type ClipboardPayload, type PasteChoice, type PastePlan } from '../../lib/editor/clipboard';
import { Dialog } from './Dialog';

/** SC-06 · the copied blocks use variables whose names this assembly already has: link them or make new ones. */
export function PasteVariablesDialog({ plan, onPaste, onCancel }: { payload: ClipboardPayload; plan: PastePlan; onPaste: (choices: Record<string, PasteChoice>) => void; onCancel: () => void }) {
  const [choices, setChoices] = useState<Record<string, PasteChoice>>(() => Object.fromEntries(plan.conflicts.map(({ variable, existing }) => [variable.id, existing.type === variable.type ? 'link' : 'rename'])));
  return (
    <Dialog title="Переменные с такими же именами" onClose={onCancel}>
      <p className="ed-hint">В скопированных блоках есть переменные, имена которых уже заняты в этой сборке. Что сделать с каждой?</p>
      {plan.conflicts.map(({ variable, existing }) => {
        const sameType = existing.type === variable.type;
        return (
          <fieldset key={variable.id} className="ed-layer" data-variable={variable.name}>
            <legend>«{variable.name}»</legend>
            <label className="ed-field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <input type="radio" name={`choice:${variable.id}`} disabled={!sameType} checked={(choices[variable.id] ?? 'link') === 'link'} onChange={() => setChoices({ ...choices, [variable.id]: 'link' })} />
              <span>Связать с переменной «{existing.name}» этой сборки{sameType ? '' : ' (другой тип — нельзя)'}</span>
            </label>
            <label className="ed-field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <input type="radio" name={`choice:${variable.id}`} checked={(choices[variable.id] ?? 'link') === 'rename'} onChange={() => setChoices({ ...choices, [variable.id]: 'rename' })} />
              <span>Создать новую переменную под другим именем</span>
            </label>
          </fieldset>
        );
      })}
      <div className="ed-actions">
        <button type="button" className="ed-btn" onClick={onCancel}>
          Отмена
        </button>
        <button type="button" className="ed-btn primary" onClick={() => onPaste(choices)}>
          Вставить
        </button>
      </div>
    </Dialog>
  );
}
