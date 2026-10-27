'use client';
import { setScreenProps } from '../../lib/editor/commands';
import { SCREEN_SECTIONS } from '../../lib/editor/screen-specs';
import { Section } from './controls';
import { useEditor } from './context';
import { Fields, type Level } from './StylePanels';

/** E-13, L-06 · the screen when no block is picked: name, kind, height, background, particles, transition in, timer. */
export function ScreenPanel() {
  const apply = useEditor((s) => s.apply);
  const doc = useEditor((s) => s.doc);
  const screenId = useEditor((s) => s.selection.screenId);
  const screen = doc.screens.find((s) => s.id === screenId) ?? doc.screens[0]!;
  const level: Level = {
    values: [screen],
    write: (change) => apply(setScreenProps(screen.id, change), { label: 'Свойства экрана', mergeKey: `screen:${screen.id}` }),
    tokens: doc.theme.tokens,
  };
  const [main, ...rest] = SCREEN_SECTIONS;
  return (
    <div data-testid="screen-panel">
      <div className="ed-section">
        <h2>{main!.title}</h2>
        <Fields fields={main!.fields} level={level} prefix="screen" />
        <p className="ed-hint">Выберите блок на экране или в слоях, чтобы изменить его.</p>
      </div>
      {rest.map((section) => (
        <Section key={section.id} id={`screen-${section.id}`} title={section.title}>
          <Fields fields={section.fields} level={level} prefix={`screen-${section.id}`} />
        </Section>
      ))}
    </div>
  );
}
