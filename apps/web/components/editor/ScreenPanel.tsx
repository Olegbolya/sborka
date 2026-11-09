'use client';
import { setScreenProps } from '../../lib/editor/commands';
import { SCREEN_SECTIONS } from '../../lib/editor/screen-specs';
import { Section } from './controls';
import { useEditor } from './context';
import { MediaByAnswerEditor } from './MediaByAnswerEditor';
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
  const phonePx = (width: number): number => Math.round((screen.height * width) / 390);
  const [main, ...rest] = SCREEN_SECTIONS;
  return (
    <div data-testid="screen-panel">
      <div className="ed-section">
        <h2>{main!.title}</h2>
        <Fields fields={main!.fields} level={level} prefix="screen" />
        <p className="ed-hint" data-testid="screen-height-hint">
          Высота указана в единицах холста: его ширина всегда 390. Холст подгоняется под ширину экрана, поэтому в пикселях высота
          отличается: на телефоне шириной 360&nbsp;px — {phonePx(360)}&nbsp;px, 390&nbsp;px — {phonePx(390)}&nbsp;px, 412&nbsp;px — {phonePx(412)}&nbsp;px. В редакторе
          она ещё зависит от масштаба.
        </p>
        <p className="ed-hint">Выберите блок на экране или в слоях, чтобы изменить его.</p>
      </div>
      {rest.map((section) => (
        <Section key={section.id} id={`screen-${section.id}`} title={section.title}>
          <Fields fields={section.fields} level={level} prefix={`screen-${section.id}`} />
        </Section>
      ))}
      <Section id="screen-media-by-answer" title="Мем по ответу" hint="Когда участник ответил на вопрос и идёт дальше, на секунду показывается ваш мем — свой для верного, неверного или выбранного ответа.">
        <MediaByAnswerEditor screen={screen} />
      </Section>
    </div>
  );
}
