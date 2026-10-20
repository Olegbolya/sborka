import { ProjectDocument, textOf } from '@blokum/schema';

/**
 * Sample screen for the /dev galleries: blocks with theme defaults and own styles, a hidden block shown
 * by a scenario, a copy spawned every second. Texts are real Russian phrases, no external assets.
 */
export const SAMPLE_DOCUMENT = ProjectDocument.parse({
  schemaVersion: 1,
  meta: { title: 'Проверка артборда' },
  variables: [{ id: 'nazhatiya', name: 'нажатия', type: 'number', initial: 0 }],
  screens: [
    {
      id: 'ekran-test',
      name: 'Новогодний экран',
      height: 844,
      rules: [
        {
          id: 'pravilo-snezhok',
          when: { kind: 'timer', mode: 'every', seconds: 1 },
          do: [{ kind: 'spawn', prototypeId: 'snezhinka', at: { kind: 'randomIn', area: { x: 0, y: 560, w: 390, h: 120 } }, max: 6 }],
        },
      ],
      blocks: [
        {
          id: 'zagolovok',
          type: 'text',
          name: 'Заголовок',
          frame: { x: 24, y: 28, w: 342, h: 120 },
          textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Какой ты ' }, { t: 'новогодний', b: true }, { t: ' персонаж?' }] }] },
          style: { text: { font: { kind: 'theme', role: 'heading' }, size: 32, weight: 800, lineHeight: 1.1, align: 'center', paint: { kind: 'linear', angle: 90, stops: [{ offset: 0, color: { token: 'primary' } }, { offset: 1, color: { token: 'accent' } }] } } },
        },
        {
          id: 'podzagolovok',
          type: 'text',
          name: 'Подзаголовок',
          frame: { x: 32, y: 152, w: 326, h: 56 },
          textLayer: textOf('Пять вопросов — и узнаешь, кто ты: Снеговик, Олень или сам Дед Мороз.'),
          style: { text: { size: 17, align: 'center', paint: { kind: 'solid', color: { token: 'muted' } } } },
        },
        {
          id: 'kartochka',
          type: 'container',
          name: 'Карточка',
          frame: { x: 24, y: 232, w: 342, h: 260 },
          style: {
            radius: { tl: 24, tr: 24, br: 24, bl: 24 },
            fills: [{ kind: 'solid', color: { token: 'surface' } }, { kind: 'radial', cx: 0.85, cy: 0.1, stops: [{ offset: 0, color: { token: 'accent', alpha: 0.25 } }, { offset: 1, color: { token: 'accent', alpha: 0 } }] }],
            shadows: [{ x: 0, y: 12, blur: 32, spread: -8, color: { hex: '#00000033' } }],
            padding: { t: 20, r: 20, b: 20, l: 20 },
          },
          children: [
            { id: 'karta-tekst', type: 'text', name: 'Текст карточки', frame: { x: 20, y: 20, w: 302, h: 80 }, textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Что ты делаешь 31 декабря?', b: true }] }, { kind: 'bullet', runs: [{ t: 'Леплю снеговика' }] }, { kind: 'bullet', runs: [{ t: 'Бегаю по магазинам' }] }] }, style: { text: { size: 16 } } },
            { id: 'shar-1', type: 'shape', name: 'Шар', frame: { x: 24, y: 150, w: 72, h: 72, rotation: 0 }, style: { radius: { unit: '%', tl: 50, tr: 50, br: 50, bl: 50 }, fills: [{ kind: 'radial', cx: 0.35, cy: 0.3, stops: [{ offset: 0, color: { hex: '#FFFFFF' } }, { offset: 0.35, color: { token: 'primary' } }, { offset: 1, color: { hex: '#5C1A06' } }] }], glow: { color: { token: 'primary', alpha: 0.6 }, size: 14 } } },
            { id: 'shar-2', type: 'shape', name: 'Шар 2', frame: { x: 134, y: 150, w: 72, h: 72 }, style: { radius: { unit: '%', tl: 50, tr: 50, br: 50, bl: 50 }, fills: [{ kind: 'conic', stops: [{ offset: 0, color: { token: 'accent' } }, { offset: 0.5, color: { token: 'success' } }, { offset: 1, color: { token: 'accent' } }] }], transform3d: { rotateY: 35, perspective: 300 } } },
            { id: 'shar-3', type: 'shape', name: 'Шар 3', frame: { x: 244, y: 150, w: 72, h: 72, rotation: 20 }, textLayer: textOf('2027'), style: { radius: { tl: 16, tr: 4, br: 16, bl: 4 }, fills: [{ kind: 'linear', angle: 45, stops: [{ offset: 0, color: { token: 'error' } }, { offset: 1, color: { hex: '#FFD43B' } }] }], text: { size: 18, weight: 800, align: 'center', verticalAlign: 'middle', paint: { kind: 'solid', color: { hex: '#FFFFFF' } }, outline: { width: 1, color: { hex: '#00000066' } } } } },
          ],
        },
        { id: 'dugoi-tekst', type: 'text', name: 'Надпись по дуге', frame: { x: 45, y: 500, w: 300, h: 60 }, textLayer: textOf('С Новым годом!'), style: { text: { size: 22, weight: 700, path: { kind: 'arc', curvature: 0.6 }, paint: { kind: 'solid', color: { token: 'accent' } } } } },
        { id: 'snezhinka', type: 'shape', name: 'Снежинка', frame: { x: 0, y: 0, w: 18, h: 18 }, initiallyHidden: true, style: { radius: { unit: '%', tl: 50, tr: 50, br: 50, bl: 50 }, fills: [{ kind: 'solid', color: { token: 'accent', alpha: 0.7 } }] } },
        {
          id: 'priz-tekst',
          type: 'text',
          name: 'Приз',
          frame: { x: 24, y: 690, w: 342, h: 40 },
          initiallyHidden: true,
          textLayer: textOf('🎁 Поехали!'),
          style: { text: { size: 20, weight: 700, align: 'center', paint: { kind: 'solid', color: { token: 'success' } } } },
        },
        {
          id: 'knopka-start',
          type: 'button',
          name: 'Начать',
          frame: { x: 75, y: 744, w: 240, h: 56 },
          textLayer: textOf('Начать'),
          rules: [{ id: 'pravilo-start', when: { kind: 'tap', source: { kind: 'block', blockId: 'knopka-start' } }, do: [{ kind: 'visibility', targets: [{ kind: 'block', blockId: 'priz-tekst' }], mode: 'toggle' }, { kind: 'setVariable', variableId: 'nazhatiya', op: 'add', value: 1 }] }],
          props: {},
        },
      ],
    },
  ],
});
