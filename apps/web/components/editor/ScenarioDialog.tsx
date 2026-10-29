'use client';
import { useState, useSyncExternalStore } from 'react';
import { allRules } from '../../lib/editor/rules';
import { SelectInput } from './controls';
import { useEditor, useEnv } from './context';
import { Dialog } from './Dialog';
import { ScenarioEditor } from './ScenarioEditor';
import { VariablesPanel } from './VariablesPanel';

type Tab = 'doc' | 'screen' | 'variables' | 'all';
const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ['doc', 'Правила сборки'],
  ['screen', 'Правила экрана'],
  ['variables', 'Переменные'],
  ['all', 'Все правила'],
];

/** SC-02 · the general panel of scenarios: rules of the assembly and of a screen, the variables, the list of all the rules. */
export function ScenarioDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const current = useEditor((s) => s.selection.screenId);
  const select = useEditor((s) => s.select);
  const { focus } = useEnv();
  const asked = useSyncExternalStore(focus.subscribe, focus.getSnapshot, focus.getSnapshot).dialog;
  const [tab, setTab] = useState<Tab>(asked?.tab ?? 'doc');
  const [screenId, setScreenId] = useState(asked?.screenId ?? current);
  const screen = doc.screens.find((s) => s.id === screenId) ?? doc.screens[0]!;
  const rules = allRules(doc);
  return (
    <Dialog title="Сценарии сборки" onClose={onClose} wide>
      <div className="ed-tabs" role="tablist">
        {TABS.map(([id, title]) => (
          <button key={id} type="button" role="tab" className="ed-tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {title}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={TABS.find(([id]) => id === tab)![1]} className="ed-logic">
        {tab === 'doc' && <ScenarioEditor owner={{ kind: 'doc' }} rules={doc.rules} title="Правила всей сборки" />}
        {tab === 'screen' && (
          <>
            <SelectInput<string> control="scenario:screen" label="Экран" value={screen.id} options={doc.screens.map((s, i) => [s.id, `${i + 1}. ${s.name}`] as const)} onChange={setScreenId} />
            <ScenarioEditor owner={{ kind: 'screen', screenId: screen.id }} rules={screen.rules} title={`Правила экрана «${screen.name}»`} />
          </>
        )}
        {tab === 'variables' && <VariablesPanel />}
        {tab === 'all' && (
          <div className="ed-section">
            <h2>Все правила</h2>
            {rules.length + doc.rules.length + doc.screens.reduce((n, s) => n + s.rules.length, 0) === 0 && <p className="ed-hint">Правил пока нет.</p>}
            <ul className="ed-hint">
              {doc.rules.length > 0 && <li>Сборка: {doc.rules.length}</li>}
              {doc.screens.map((s) => (s.rules.length > 0 ? <li key={s.id}>Экран «{s.name}»: {s.rules.length}</li> : null))}
              {rules.map(({ block, rule, screenId: sid, screenName }) => (
                <li key={rule.id}>
                  <button
                    type="button"
                    className="ed-link"
                    onClick={() => {
                      select(sid, [block.id]);
                      onClose();
                    }}
                  >
                    {screenName} · {block.name}: {rule.name ?? rule.when.kind}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="ed-actions">
        <button type="button" className="ed-btn" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </Dialog>
  );
}
