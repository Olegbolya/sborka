'use client';
import type { Fill } from '@blokum/schema';
import { useState } from 'react';
import { setDescription, setOgImage, setScreenProps } from '../../lib/editor/commands';
import { SCREEN_SECTIONS } from '../../lib/editor/screen-specs';
import { Section } from './controls';
import { useEditor } from './context';
import { CoverThumb } from './CoverThumb';
import { MediaByAnswerEditor } from './MediaByAnswerEditor';
import { MediaPicker } from './MediaPicker';
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
          {section.id === 'background' && <MediaBackgroundButton screenId={screen.id} layers={screen.background} />}
          <Fields fields={section.fields} level={level} prefix={`screen-${section.id}`} />
        </Section>
      ))}
      <Section id="link-preview" title="Превью ссылки" hint="Так сборка выглядит, когда ссылку отправляют в мессенджер. Без своей картинки в превью попадает снимок первого экрана, он делается при каждой публикации.">
        <LinkPreview />
      </Section>
      <Section id="screen-media-by-answer" title="Мем по ответу" hint="Когда участник ответил на вопрос и идёт дальше, на секунду показывается ваш мем — свой для верного, неверного или выбранного ответа.">
        <MediaByAnswerEditor screen={screen} />
      </Section>
    </div>
  );
}

/** PL-04 · описание и своя картинка для превью ссылки. */
function LinkPreview() {
  const apply = useEditor((s) => s.apply);
  const meta = useEditor((s) => s.doc.meta);
  const [picking, setPicking] = useState(false);
  const own = meta.ogImage?.source === 'media' ? meta.ogImage.id : null;
  return (
    <div data-testid="link-preview">
      <label className="ed-field">
        <span>Описание</span>
        <textarea
          rows={3}
          style={{ fontFamily: 'inherit' }}
          maxLength={500}
          value={meta.description}
          placeholder="Одно-два предложения: что внутри"
          onChange={(e) => apply(setDescription(e.target.value), { label: 'Описание сборки', mergeKey: 'description' })}
        />
      </label>
      <div className="ed-actions" style={{ alignItems: 'center' }}>
        <CoverThumb id={own} />
        <button type="button" className="ed-btn" onClick={() => setPicking(true)}>
          {own ? 'Другая картинка' : 'Своя картинка'}
        </button>
        {own && (
          <button type="button" className="ed-btn" onClick={() => apply(setOgImage(null), { label: 'Убрать картинку превью' })}>
            Убрать
          </button>
        )}
      </div>
      {!own && <p className="ed-hint">Своей картинки нет — будет снимок первого экрана.</p>}
      {picking && (
        <MediaPicker
          kinds={['IMAGE']}
          onClose={() => setPicking(false)}
          onPick={(ref) => {
            setPicking(false);
            if (ref.source === 'media') apply(setOgImage({ source: 'media', id: ref.id }), { label: 'Картинка превью' });
          }}
        />
      )}
    </div>
  );
}

/**
 * E-13 · фото, GIF или видео на фон одной кнопкой. Тот же слой можно выбрать в списке «Слой», но там он спрятан среди
 * видов заливки; кнопка добавляет его поверх остальных слоёв (они рисуются снизу вверх) и сразу открывает выбор файла.
 * Слоёв не больше четырёх: если их уже четыре, файл заменяет верхний.
 */
function MediaBackgroundButton({ screenId, layers }: { screenId: string; layers: readonly Fill[] }) {
  const apply = useEditor((s) => s.apply);
  const [picking, setPicking] = useState(false);
  return (
    <div className="ed-actions" style={{ marginBottom: 8 }}>
      <button type="button" className="ed-btn" data-testid="screen-bg-media" onClick={() => setPicking(true)}>
        Фото или видео на фон
      </button>
      {picking && (
        <MediaPicker
          kinds={['IMAGE', 'GIF', 'VIDEO']}
          onClose={() => setPicking(false)}
          onPick={(ref) => {
            setPicking(false);
            const layer: Fill = { kind: 'media', media: ref, fit: 'cover', focal: { x: 0.5, y: 0.5 }, scale: 1 };
            const next = layers.length >= 4 ? [...layers.slice(0, 3), layer] : [...layers, layer];
            apply(setScreenProps(screenId, (props) => ({ ...props, background: next })), { label: 'Фон экрана: фото или видео' });
          }}
        />
      )}
    </div>
  );
}
