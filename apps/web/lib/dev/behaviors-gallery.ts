import { type BlockInput, ProjectDocument, type RuleInput, textOf } from '@blokum/schema';

type Style = NonNullable<BlockInput['style']>;

const solid = (token: string, alpha = 1) => [{ kind: 'solid' as const, color: { token, alpha } }];
const label = (size = 16, color = 'text'): Style['text'] => ({ size, weight: 700, align: 'center', verticalAlign: 'middle', paint: { kind: 'solid', color: { token: color } } });
const round = (r: number): Style['radius'] => ({ tl: r, tr: r, br: r, bl: r });
type ShapeInput = Extract<BlockInput, { type: 'shape' }>;
const tile = (id: string, text: string, frame: BlockInput['frame'], extra: Partial<Omit<ShapeInput, 'type'>> = {}): ShapeInput => ({
  id,
  type: 'shape',
  name: text,
  frame,
  style: { radius: round(14), fills: solid('surface'), shadows: [{ x: 0, y: 4, blur: 10, color: { hex: '#00000026' } }], text: label(18) },
  textLayer: textOf(text),
  ...extra,
});
const rule = (id: string, when: RuleInput['when'], actions: RuleInput['do']): RuleInput => ({ id, name: id, when, do: actions });
const confetti = { kind: 'effect' as const, effect: 'confetti' as const, intensity: 1 };

export interface BehaviorScene {
  id: string;
  title: string;
  hint: string;
  doc: ProjectDocument;
}

const scene = (id: string, title: string, hint: string, height: number, blocks: BlockInput[], rules: RuleInput[] = [], variables: unknown[] = []): BehaviorScene => ({
  id,
  title,
  hint,
  doc: ProjectDocument.parse({ schemaVersion: 1, meta: { title }, variables, screens: [{ id: `ekran-${id}`, name: title, height, background: solid('background'), blocks, rules }] }),
});

/** Six sectors of the wheel: labels around the centre, clockwise from the top (BH-06). */
const SECTORS = ['🎁', '⛄', '🎄', '🦌', '🍊'];
const SECTOR_ANGLE = 360 / SECTORS.length;
const wheelSectors = (): BlockInput[] =>
  SECTORS.map((emoji, i) => {
    const deg = i * SECTOR_ANGLE + SECTOR_ANGLE / 2;
    const a = (deg * Math.PI) / 180;
    return { id: `sektor-${i}`, type: 'shape', name: `Сектор ${i + 1}`, frame: { x: 130 + Math.sin(a) * 85 - 22, y: 130 - Math.cos(a) * 85 - 22, w: 44, h: 44, rotation: deg }, style: { text: { size: 26, align: 'center', verticalAlign: 'middle' } }, textLayer: textOf(emoji), states: { selected: { glow: { color: { hex: '#FFFFFF' }, size: 14 } } } };
  });

/** Scenes of P1.9: each behavior on the real runtime, as small examples of the reference games (RG-xx). */
export function buildBehaviorScenes(): BehaviorScene[] {
  return [
    scene('drag', 'BH-01 · Перетащи подарки в мешок', 'Тащите пальцем или мышью; мимо мешка подарок вернётся на место.', 420, [
      { id: 'meshok', type: 'zone', name: 'Мешок', frame: { x: 215, y: 250, w: 150, h: 150 }, style: { radius: round(24) }, props: { visible: true } },
      { id: 'meshok-podpis', type: 'text', name: 'Мешок', frame: { x: 215, y: 300, w: 150, h: 40 }, style: { text: label(15, 'muted') }, textLayer: textOf('Мешок') },
      ...['🎁', '🧸', '🍬'].map((e, i) => tile(`podarok-${i}`, e, { x: 25 + i * 60, y: 40, w: 52, h: 52 }, { behaviors: [{ kind: 'drag', snapToZones: ['meshok'] }], states: { dragging: { shadows: [{ y: 12, blur: 22, color: { hex: '#00000047' } }] } } })),
      tile('polzunok', '↔', { x: 25, y: 300, w: 52, h: 52 }, { behaviors: [{ kind: 'drag', axis: 'x', bounds: { x: 25, y: 300, w: 170, h: 52 }, returnIfMissed: false }] }),
    ], ['podarok-0', 'podarok-1', 'podarok-2'].map((id, i) => rule(`v-meshok-${i}`, { kind: 'drop', source: { kind: 'block', blockId: id }, target: { kind: 'block', blockId: 'meshok' } }, [confetti]))),
    scene('flee', 'BH-02 · Убегающая кнопка «Нет»', 'Попробуйте нажать «Нет»: она убежит 5 раз, потом сдастся и станет «Да».', 400, [
      tile('vopros', 'Пойдёшь на ёлку?', { x: 45, y: 40, w: 300, h: 60 }, { style: { text: label(20) } }),
      tile('knopka-da', 'Да', { x: 60, y: 200, w: 110, h: 52 }, { style: { radius: round(26), fills: solid('success'), text: label(18, 'surface') } }),
      tile('knopka-net', 'Нет', { x: 220, y: 200, w: 110, h: 52 }, { style: { radius: round(26), fills: solid('error'), text: label(18, 'surface') }, behaviors: [{ kind: 'flee', distance: 70, speed: 1.5, times: 5 }] }),
    ], [rule('net-stal-da', { kind: 'tap', source: { kind: 'block', blockId: 'knopka-net' } }, [{ kind: 'setProperty', target: { kind: 'self' }, property: 'textLayer', value: textOf('Да!') }, confetti])]),
    scene('scratch', 'BH-03 · Скретч-карта', 'Сотрите серебряный слой пальцем или мышью: на 60 % он исчезнет.', 400, [
      tile('priz-podarok', '🎁 Приз: мандарины!', { x: 45, y: 90, w: 300, h: 180 }, { style: { radius: round(20), fills: solid('accent', 0.25), text: label(22) } }),
      {
        id: 'serebro',
        type: 'shape',
        name: 'Стираемый слой',
        frame: { x: 45, y: 90, w: 300, h: 180 },
        style: { radius: round(20), fills: [{ kind: 'linear', angle: 120, stops: [{ offset: 0, color: { hex: '#B8BEC6' } }, { offset: 0.5, color: { hex: '#E8EBEF' } }, { offset: 1, color: { hex: '#9AA1AB' } }] }], text: { size: 20, weight: 700, align: 'center', verticalAlign: 'middle', paint: { kind: 'solid', color: { hex: '#1D1B18' } } } },
        textLayer: textOf('Сотри меня'),
        behaviors: [{ kind: 'scratch', brush: 40, threshold: 60 }],
      },
    ], [rule('priz-otkryt', { kind: 'scratched', source: { kind: 'block', blockId: 'serebro' }, percent: 60 }, [confetti])]),
    scene('move', 'BH-04 · Движение', 'Отскок от краёв, «по кругу» за край, гравитация и свой контур.', 420, [
      tile('myach01', '⚽', { x: 40, y: 60, w: 44, h: 44 }, { style: { radius: round(22), fills: solid('surface'), text: label(26) }, behaviors: [{ kind: 'move', angle: 35, speed: 160, edge: 'bounce' }] }),
      tile('oblako', '☁️', { x: 0, y: 140, w: 60, h: 40 }, { style: { fills: [], text: label(30) }, behaviors: [{ kind: 'move', angle: 0, speed: 60, edge: 'wrap' }] }),
      tile('yabloko', '🍎', { x: 300, y: 40, w: 40, h: 40 }, { style: { fills: [], text: label(28) }, behaviors: [{ kind: 'move', angle: 200, speed: 80, gravity: 220, edge: 'bounce' }] }),
      tile('pchela', '🐝', { x: 150, y: 260, w: 40, h: 40 }, { style: { fills: [], text: label(28) }, behaviors: [{ kind: 'move', speed: 90, path: 'M0 0 C 60 -60 120 60 180 0 C 120 -60 60 60 0 0' }] }),
    ]),
    scene('spawner', 'BH-05 · Поймай снежинки', 'Снежинки появляются сверху и падают; нажимайте на них — счёт растёт.', 460, [
      { id: 'snezhinka', type: 'shape', name: 'Снежинка', frame: { x: 0, y: 0, w: 44, h: 44 }, initiallyHidden: true, style: { text: label(32) }, textLayer: textOf('❄️'), behaviors: [{ kind: 'move', angle: 90, speed: 110, spread: 30, edge: 'destroy' }] },
      { id: 'generator', type: 'shape', name: 'Генератор', frame: { x: 0, y: 0, w: 1, h: 1 }, behaviors: [{ kind: 'spawner', prototypeId: 'snezhinka', everyMs: 600, area: { x: 10, y: 0, w: 370, h: 20 }, max: 8 }] },
      { id: 'schet01', type: 'value', name: 'Счёт', frame: { x: 270, y: 410, w: 110, h: 40 }, style: { text: label(22) }, a11y: { label: 'Поймано' }, props: { variableId: 'poimano', format: 'number' } },
    ], [rule('poimal', { kind: 'tap', source: { kind: 'copiesOf', blockId: 'snezhinka' } }, [{ kind: 'setVariable', variableId: 'poimano', op: 'add', value: 1 }, { kind: 'destroy', target: { kind: 'self' } }])], [{ id: 'poimano', name: 'поймано', type: 'number', initial: 0 }]),
    scene('wheel', 'BH-06 · Колесо фортуны', 'Нажмите на колесо (или Enter): сектор выбирает сервер, колесо встаёт на него.', 420, [
      { id: 'strelka', type: 'shape', name: 'Указатель', frame: { x: 180, y: 10, w: 30, h: 30, rotation: 180 }, style: { shape: { kind: 'polygon', sides: 3 }, fills: solid('text') } },
      {
        id: 'koleso',
        type: 'container',
        name: 'Колесо',
        frame: { x: 65, y: 40, w: 260, h: 260 },
        style: { shape: { kind: 'ellipse' }, fills: [{ kind: 'conic', stops: SECTORS.flatMap((_, i) => [0, 1].map((edge) => ({ offset: (i + edge) / SECTORS.length - edge * 0.0001, color: { token: ['primary', 'accent', 'success', 'error', 'muted'][i]!, alpha: 0.85 } }))) }], stroke: { width: 4, paint: { kind: 'solid', color: { token: 'surface' } } } },
        children: wheelSectors(),
        behaviors: [{ kind: 'wheel', spinMs: 4000, sectors: SECTORS.map((_, i) => ({ blockId: `sektor-${i}`, weight: 1 })) }],
      },
    ], [rule('vypalo', { kind: 'mediaEnd', source: { kind: 'block', blockId: 'koleso' } }, [confetti])]),
    scene('flip', 'BH-07 · Мемори: переверни карточку', 'Нажмите на карточку — она перевернётся; ещё раз — обратно.', 400, ['🎄', '⛄', '🎄'].map((e, i) => ({
      id: `karta-${i}`,
      type: 'container' as const,
      name: `Карточка ${i + 1}`,
      frame: { x: 30 + i * 115, y: 60, w: 100, h: 140 },
      children: [
        { id: `lico-${i}`, type: 'shape' as const, name: 'Рубашка', frame: { x: 0, y: 0, w: 100, h: 140 }, style: { radius: round(14), fills: solid('primary'), text: label(40, 'surface') }, textLayer: textOf('?') },
        { id: `oborot-${i}`, type: 'shape' as const, name: 'Картинка', frame: { x: 0, y: 0, w: 100, h: 140 }, style: { radius: round(14), fills: solid('surface'), text: label(48) }, textLayer: textOf(e) },
      ],
      behaviors: [{ kind: 'flip' as const, frontId: `lico-${i}`, backId: `oborot-${i}`, durationMs: 450 }],
    }))),
    scene('follow', 'BH-08 · Звезда за пальцем', 'Водите пальцем или мышью по области: звезда следует с небольшой задержкой.', 400, [
      { id: 'oblast', type: 'shape', name: 'Область', frame: { x: 20, y: 20, w: 350, h: 280 }, style: { radius: round(20), fills: solid('surface'), stroke: { width: 2, style: 'dashed', paint: { kind: 'solid', color: { token: 'muted' } } } } },
      { id: 'zvezda', type: 'shape', name: 'Звезда', frame: { x: 175, y: 140, w: 40, h: 40 }, style: { shape: { kind: 'star' }, fills: solid('accent') }, behaviors: [{ kind: 'follow', lagMs: 120, bounds: { x: 20, y: 20, w: 350, h: 280 } }] },
    ]),
  ];
}

/** SC-05: fifty moving and bouncing objects — the frame budget check of P1.9. */
export function buildPerfScene(): BehaviorScene {
  const blocks: BlockInput[] = Array.from({ length: 50 }, (_, i) => ({
    id: `sharik-${String(i).padStart(2, '0')}`,
    type: 'shape',
    name: `Шарик ${i + 1}`,
    frame: { x: 10 + ((i * 37) % 340), y: 10 + ((i * 53) % 700), w: 28, h: 28 },
    style: { shape: { kind: 'ellipse' }, fills: solid(i % 3 === 0 ? 'primary' : i % 3 === 1 ? 'accent' : 'success') },
    behaviors: [{ kind: 'move', angle: (i * 47) % 360, speed: 80 + (i % 7) * 20, edge: 'bounce' }],
  }));
  return scene('perf', 'SC-05 · 50 движущихся объектов', 'Проверка производительности: 50 блоков с отскоком.', 760, blocks);
}
