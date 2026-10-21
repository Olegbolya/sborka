import { type AnswerValue, type RuntimeEvent, createRuntime } from '@blokum/engine';
import { type Block, type BlockInput, ProjectDocument, createBlock, textOf } from '@blokum/schema';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { block, media, render, styleOf } from './helpers.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lottie = vi.hoisted(() => ({ setWasmUrl: vi.fn(), created: [] as Array<Record<string, unknown>>, setFrame: vi.fn(), destroy: vi.fn() }));
vi.mock('@lottiefiles/dotlottie-web', () => ({
  DotLottie: class {
    static setWasmUrl = lottie.setWasmUrl;
    constructor(config: Record<string, unknown>) {
      lottie.created.push(config);
    }
    addEventListener(_type: string, fn: () => void) {
      fn();
    }
    setFrame = lottie.setFrame;
    destroy = lottie.destroy;
  },
}));

const { Artboard, BlockView, DEV_THEMES, LOTTIE_WASM_URL, PlayerScreen, RuntimeStore, dateText, dateValue, durationInWords, formatBlockValue, formatTimer, isPressable, maskDate, requiredMissing } = await import('../src/index.js');

/** Media of the tests: «video…» ids are video, «zvuk…» sound, «lottie…» Lottie, the rest pictures. */
const kinds: typeof media = (ref) =>
  ref.id.startsWith('zvuk') ? { url: `/m/${ref.id}.mp3`, kind: 'audio' } : ref.id.startsWith('lottie') ? { url: `/m/${ref.id}.lottie`, kind: 'lottie' } : ref.id.startsWith('video') ? { url: `/m/${ref.id}.mp4`, kind: 'video', poster: `/m/${ref.id}.jpg` } : media(ref);

interface Live {
  host: HTMLElement;
  events: RuntimeEvent[];
  rerender: (extra?: Record<string, unknown>) => void;
  unmount: () => void;
}

/** Mounts blocks in the player with a recording `dispatch` and the given answers (no runtime). */
function live(blocks: Block[], extra: Record<string, unknown> = {}): Live {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const events: RuntimeEvent[] = [];
  const draw = (more: Record<string, unknown> = {}) =>
    act(() =>
      root.render(
        <Artboard mode="player" tokens={DEV_THEMES.light} media={kinds} dispatch={(e) => events.push(e)} {...extra} {...more}>
          {blocks.map((b) => (
            <BlockView key={b.id} block={b} />
          ))}
        </Artboard>,
      ),
    );
  draw();
  return { host, events, rerender: draw, unmount: () => act(() => root.unmount()) };
}

/** A block with a valid lowercase id (`blok-textinput`), so camel-case types work too. */
const make = (type: BlockInput['type'], extra: Partial<BlockInput> = {}) => block(type, { id: `blok-${type.toLowerCase()}`, ...extra });
const click = (el: Element | null) =>
  act(() => {
    (el as HTMLElement).click();
  });
const key = (el: Element | null, k: string) =>
  act(() => {
    el!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
const type = (el: Element | null, value: string) =>
  act(() => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const answersOf = (events: RuntimeEvent[]) => events.flatMap((e) => (e.type === 'answer' ? [e.answer] : []));

beforeEach(() => {
  lottie.created.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('B-02…B-05, B-07: медиаблоки', () => {
  it('B-02: картинка с alt, кадрированием и подписью', () => {
    const img = make('image', { a11y: { alt: 'Зимний лес' }, props: { media: { source: 'media', id: 'foto000001' }, caption: 'Фото автора' }, style: { media: { crop: { x: 0.25, y: 0, w: 0.5, h: 1 } } } });
    const host = render(<BlockView block={img} />, { media: kinds });
    const el = host.querySelector('img')!;
    expect(el.getAttribute('alt')).toBe('Зимний лес');
    expect(styleOf(el)).toContain('width:200%');
    expect(styleOf(el)).toContain('left:-50%');
    expect(host.querySelector('.bk-caption')?.textContent).toBe('Фото автора');
  });

  it('S-05 · S-15: обводка — рамка поверх фото и видео, а не под ними', () => {
    const host = render(<BlockView block={make('image', { props: { media: { source: 'media', id: 'foto000001' } }, style: { stroke: { width: 3 } } })} />);
    const content = host.querySelector('.bk-content')!;
    const stroke = host.querySelector('.bk-stroke')!;
    expect(content.compareDocumentPosition(stroke) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(styleOf(stroke)).toContain('pointer-events:none');
  });

  it('B-02: без файла в редакторе — подсказка, у участника — ничего', () => {
    expect(render(<BlockView block={make('image')} />).querySelector('.bk-no-file')?.textContent).toBe('Добавьте изображение');
    expect(render(<BlockView block={make('image')} />, { mode: 'player' }).querySelector('.bk-no-file')).toBeNull();
    for (const [t, label] of [['gif', 'Добавьте GIF'], ['video', 'Добавьте видео'], ['audio', 'Добавьте звук'], ['animation', 'Добавьте анимацию']] as const) {
      expect(render(<BlockView block={make(t)} />).querySelector('.bk-no-file')?.textContent).toBe(label);
    }
  });

  it('B-03: GIF хранится видео и всегда идёт по кругу без звука; GIF-картинка — тегом img', () => {
    const v = live([make('gif', { props: { media: { source: 'media', id: 'video-gif1' } }, style: { media: { loop: false, muted: false, speed: 3 } } })]);
    const video = v.host.querySelector('video')!;
    expect([video.loop, video.muted, video.autoplay, video.getAttribute('poster'), video.playbackRate]).toEqual([true, true, true, '/m/video-gif1.jpg', 1]);
    v.unmount();
    expect(render(<BlockView block={make('gif', { props: { media: { source: 'media', id: 'kartinka01' } } })} />).querySelector('img')).not.toBeNull();
  });

  it('B-04: видео по медиа-настройкам, «закончилось» уходит в движок, команды сценария управляют им', () => {
    const vb = make('video', { props: { media: { source: 'media', id: 'video-film' } }, style: { media: { autoplay: false, loop: false, controls: true, speed: 1.5, poster: { source: 'media', id: 'oblozhka01' } } } });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const view = { id: vb.id, protoId: vb.id, copy: false, parentId: null, visible: true, animateVisibility: false, interactive: true, dragging: false, zoneId: null, selected: false, x: 0, y: 0, w: 50, h: 50, rotation: 0, z: 0, overrides: {}, anim: {}, media: null as 'playing' | 'paused' | 'stopped' | null };
    const v = live([vb], { views: new Map([[vb.id, view]]) });
    const video = v.host.querySelector('video')!;
    expect([video.autoplay, video.loop, video.controls, video.playbackRate, video.getAttribute('poster')]).toEqual([false, false, true, 1.5, 'https://media.blokum.ru/oblozhka01.webp']);
    act(() => {
      video.dispatchEvent(new Event('ended'));
    });
    expect(v.events).toEqual([{ type: 'mediaEnd', blockId: vb.id }]);
    v.rerender({ views: new Map([[vb.id, { ...view, media: 'playing' }]]) });
    expect(play).toHaveBeenCalled();
    v.rerender({ views: new Map([[vb.id, { ...view, media: 'paused' }]]) });
    expect(pause).toHaveBeenCalledTimes(1);
    video.currentTime = 5;
    v.rerender({ views: new Map([[vb.id, { ...view, media: 'stopped' }]]) });
    expect(video.currentTime).toBe(0);
    v.unmount();
    vi.restoreAllMocks();
  });

  it('B-05: звук — настоящая кнопка; играет после первого действия участника, громкость из настроек', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const ab = make('audio', { name: 'Бубенцы', props: { media: { source: 'media', id: 'zvuk000001' }, volume: 0.4 } });
    const v = live([ab]);
    const audio = v.host.querySelector('audio')!;
    expect(audio.volume).toBeCloseTo(0.4);
    const btn = v.host.querySelector('button.bk-audio-toggle')!;
    expect(btn.getAttribute('aria-label')).toBe('Включить звук: Бубенцы');
    expect(play).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    expect(play).toHaveBeenCalledTimes(1);
    click(btn);
    expect(play).toHaveBeenCalledTimes(2);
    act(() => {
      audio.dispatchEvent(new Event('play'));
    });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-label')).toBe('Пауза: Бубенцы');
    act(() => {
      audio.dispatchEvent(new Event('ended'));
    });
    expect(v.events).toEqual([{ type: 'mediaEnd', blockId: ab.id }]);
    v.unmount();
    vi.restoreAllMocks();
  });

  it('B-07: Lottie — только через dotlottie-web и со своим wasm; кадр останавливает анимацию на нём', async () => {
    const v = live([make('animation', { props: { media: { source: 'media', id: 'lottie0001' }, frame: 12 }, style: { media: { speed: 2 } } })]);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(lottie.setWasmUrl).toHaveBeenCalledWith(LOTTIE_WASM_URL);
    expect(LOTTIE_WASM_URL.startsWith('/vendor/')).toBe(true);
    expect(lottie.created[0]).toMatchObject({ src: '/m/lottie0001.lottie', autoplay: false, speed: 2, loop: true });
    expect(lottie.setFrame).toHaveBeenCalledWith(12);
    v.unmount();
    expect(lottie.destroy).toHaveBeenCalled();
  });

  it('B-07: анимированный WebP — картинкой, WebM с прозрачностью — видео', () => {
    expect(render(<BlockView block={make('animation', { props: { media: { source: 'media', id: 'stiker0001' } }, a11y: { alt: 'Олень' } })} />).querySelector('img')?.getAttribute('alt')).toBe('Олень');
    expect(render(<BlockView block={make('animation', { props: { media: { source: 'media', id: 'video-alfa' } } })} />, { media: kinds }).querySelector('video')).not.toBeNull();
  });
});

const choice = (multi = false) => {
  const q = createBlock(multi ? 'multiChoice' : 'singleChoice', { id: 'vopros-galerei', name: 'Любимый праздник' });
  return q as Extract<Block, { type: 'singleChoice' | 'multiChoice' }>;
};

describe('B-11 · B-12: варианты — самостоятельные блоки с ролью радио или флажка', () => {
  it('B-11: варианты — радиокнопки в группе, нажатие и пробел выбирают; выбранный — по ответу', () => {
    const q = choice();
    const v = live([q]);
    const group = v.host.querySelector(`[data-block-id="${q.id}"]`)!;
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-label')).toBe('Любимый праздник');
    const options = [...v.host.querySelectorAll('[role="radio"]')];
    expect(options).toHaveLength(q.props.options.length);
    expect(options.every((o) => o.getAttribute('tabindex') === '0' && o.getAttribute('aria-checked') === 'false')).toBe(true);
    click(options[1]!);
    key(options[0]!, ' ');
    expect(answersOf(v.events)).toEqual([
      { kind: 'choice', optionIds: [q.props.options[1]!.id] },
      { kind: 'choice', optionIds: [q.props.options[0]!.id] },
    ]);
    v.rerender({ answers: { [q.id]: { kind: 'choice', optionIds: [q.props.options[1]!.id] } } });
    expect(v.host.querySelectorAll('[role="radio"]')[1]!.getAttribute('aria-checked')).toBe('true');
    expect(v.host.querySelectorAll('[role="radio"]')[1]!.getAttribute('data-state')).toBe('selected');
    v.unmount();
  });

  it('B-12: флажки добавляют и снимают свой вариант, пустой выбор — нет ответа', () => {
    const q = choice(true);
    const [a, b] = q.props.options.map((o) => o.id);
    const v = live([q], { answers: { [q.id]: { kind: 'choice', optionIds: [a!] } } });
    expect(v.host.querySelector(`[data-block-id="${q.id}"]`)!.getAttribute('role')).toBe('group');
    const boxes = [...v.host.querySelectorAll('[role="checkbox"]')];
    click(boxes[1]!);
    click(boxes[0]!);
    expect(answersOf(v.events)).toEqual([{ kind: 'choice', optionIds: [a, b] }, null]);
    v.unmount();
  });

  it('B-11: в редакторе варианты не в порядке обхода клавиатурой и не отвечают', () => {
    const host = render(<BlockView block={choice()} />);
    expect([...host.querySelectorAll('[role="radio"]')].every((o) => o.getAttribute('tabindex') === '-1')).toBe(true);
  });
});

describe('B-13…B-17, B-19, B-20: вопросы', () => {
  it('B-13: поле с подписью для скринридера, ответ уходит после паузы или ухода из поля', () => {
    vi.useFakeTimers();
    const t = make('textInput', { name: 'Как зовут оленя', props: { placeholder: 'Например, Рудольф', maxLength: 30, required: true } });
    const v = live([t]);
    const input = v.host.querySelector('input')!;
    expect([input.getAttribute('aria-label'), input.placeholder, input.maxLength, input.required]).toEqual(['Как зовут оленя', 'Например, Рудольф', 30, true]);
    type(input, 'Руд');
    type(input, 'Рудольф');
    expect(answersOf(v.events)).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(answersOf(v.events)).toEqual([{ kind: 'text', value: 'Рудольф' }]);
    type(input, '');
    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(answersOf(v.events).at(-1)).toBeNull();
    v.unmount();
  });

  it('B-13: многострочный ответ, числовая клавиатура и автозаполнение по смыслу поля', () => {
    expect(render(<BlockView block={make('textInput', { props: { multiline: true } })} />).querySelector('textarea')).not.toBeNull();
    const num = render(<BlockView block={make('textInput', { props: { mask: 'number' } })} />).querySelector('input')!;
    expect(num.getAttribute('inputmode')).toBe('decimal');
    const phone = render(<BlockView block={make('textInput', { props: { semantic: 'phone' } })} />).querySelector('input')!;
    expect([phone.type, phone.getAttribute('autocomplete'), phone.getAttribute('inputmode')]).toEqual(['tel', 'tel', 'tel']);
    expect(render(<BlockView block={make('textInput', { props: { semantic: 'email' } })} />).querySelector('input')!.type).toBe('email');
  });

  it('B-14: шкала — радиогруппа в строку, нажатие и стрелки клавиатуры меняют значение', () => {
    const s = make('scale', { name: 'Оценка', props: { min: 1, max: 5 } });
    const v = live([s], { answers: { [s.id]: { kind: 'number', value: 3 } } });
    const group = v.host.querySelector<HTMLElement>('[role="radiogroup"]')!;
    expect(group.style.flexDirection).toBe('row');
    expect(group.getAttribute('aria-label')).toBe('Оценка');
    const items = [...group.querySelectorAll('[role="radio"]')];
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual(['1 из 5', '2 из 5', '3 из 5', '4 из 5', '5 из 5']);
    expect(items.map((i) => i.textContent)).toEqual(['★', '★', '★', '☆', '☆']);
    expect(items[2]!.getAttribute('tabindex')).toBe('0');
    click(items[4]!);
    key(items[2]!, 'ArrowRight');
    key(items[2]!, 'ArrowLeft');
    key(items[2]!, 'Tab');
    expect(answersOf(v.events)).toEqual([
      { kind: 'number', value: 5 },
      { kind: 'number', value: 4 },
      { kind: 'number', value: 2 },
    ]);
    v.unmount();
  });

  it('B-14: варианты шкалы — сердечки, эмодзи, числа, свои картинки и слайдер с подписями', () => {
    const icons = (variant: string, extra: Record<string, unknown> = {}) =>
      [...render(<BlockView block={make('scale', { props: { variant: variant as 'stars', min: 1, max: 3, ...extra } })} />, { answers: { 'blok-scale': { kind: 'number', value: 2 } } }).querySelectorAll('[role="radio"]')].map((i) => i.textContent);
    expect(icons('hearts')).toEqual(['♥', '♥', '♡']);
    expect(icons('emoji')).toEqual(['😞', '🙁', '😐']);
    expect(icons('numbers')).toEqual(['1', '2', '3']);
    const pics = render(<BlockView block={make('scale', { props: { variant: 'images', min: 1, max: 2, icons: [{ source: 'media', id: 'snezhinka1' }] } })} />);
    expect(pics.querySelectorAll('img')).toHaveLength(2);
    const slider = live([make('scale', { props: { variant: 'slider', min: 0, max: 10, labels: { min: 'Холодно', max: 'Жарко' } } })]);
    const range = slider.host.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider.host.textContent).toContain('Холодно');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(range, '7');
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(answersOf(slider.events)).toEqual([{ kind: 'number', value: 7 }]);
    slider.unmount();
  });

  it('B-15: свайп — кнопки и смахивание дальше 30 % ширины, короткое смахивание не считается', () => {
    const sw = make('swipe', { name: 'Любите снег?', frame: { x: 0, y: 0, w: 300, h: 300 } });
    const v = live([sw], { answers: { [sw.id]: { kind: 'swipe', value: 'right' } } });
    expect(v.host.textContent).toContain('Да');
    const [left] = v.host.querySelectorAll('.bk-swipe-button');
    click(left!);
    const area = v.host.querySelector<HTMLElement>('.bk-swipe')!;
    v.host.querySelector<HTMLElement>('.bk-block')!.getBoundingClientRect = () => ({ width: 300 }) as DOMRect;
    const pointer = (t: string, x: number) =>
      act(() => {
        const e = new MouseEvent(t, { bubbles: true, clientX: x });
        Object.defineProperty(e, 'pointerId', { value: 1 });
        area.dispatchEvent(e);
      });
    pointer('pointerdown', 200);
    pointer('pointermove', 60);
    expect(v.host.querySelector<HTMLElement>('.bk-block')!.style.translate).toBe('-140px 0');
    pointer('pointerup', 60);
    pointer('pointerdown', 100);
    pointer('pointerup', 150);
    expect(answersOf(v.events)).toEqual([
      { kind: 'swipe', value: 'left' },
      { kind: 'swipe', value: 'left' },
    ]);
    expect(v.host.querySelector<HTMLElement>('.bk-block')!.style.translate).toBe('');
    v.unmount();
  });

  it('B-16: ранжирование — список с кнопками «выше / ниже» и перетаскиванием', () => {
    const r = make('ranking', { name: 'Порядок подарков' }) as Extract<Block, { type: 'ranking' }>;
    const [a, b, c] = r.props.items.map((i) => i.id);
    const v = live([r]);
    expect(v.host.querySelector('ol')!.getAttribute('aria-label')).toBe('Порядок подарков');
    const down = v.host.querySelector(`button[aria-label="Ниже: ${r.props.items[0]!.label}"]`)!;
    click(down);
    expect(v.host.querySelector(`button[aria-label="Выше: ${r.props.items[0]!.label}"]`)!.hasAttribute('disabled')).toBe(true);
    const li = v.host.querySelectorAll('li')[2]!;
    li.getBoundingClientRect = () => ({ height: 40 }) as DOMRect;
    const ev = (t: string, y: number) =>
      act(() => {
        const e = new MouseEvent(t, { bubbles: true, clientY: y });
        Object.defineProperty(e, 'pointerId', { value: 2 });
        li.dispatchEvent(e);
      });
    ev('pointerdown', 300);
    ev('pointermove', 210);
    expect(li.getAttribute('data-dragging')).toBe('');
    ev('pointerup', 210);
    expect(answersOf(v.events)).toEqual([
      { kind: 'ranking', order: [b, a, c] },
      { kind: 'ranking', order: [c, a, b] },
    ]);
    v.unmount();
  });

  it('B-17: дата и время — русская маска «дд.мм.гггг», ответ в ISO, неполная дата не отправляется', () => {
    const d = make('date', { name: 'Дата праздника', props: { mode: 'datetime', min: '2026-12-01T00:00', max: '2026-12-31T23:59' } });
    const v = live([d]);
    const field = v.host.querySelector<HTMLInputElement>('input.bk-field')!;
    expect([field.placeholder, field.getAttribute('aria-label'), field.getAttribute('inputmode')]).toEqual(['дд.мм.гггг чч:мм', 'Дата праздника, формат дд.мм.гггг чч:мм', 'numeric']);
    type(field, '3112');
    expect(field.value).toBe('31.12');
    type(field, '311220262000');
    expect(field.value).toBe('31.12.2026 20:00');
    const native = v.host.querySelector<HTMLInputElement>('input[aria-hidden="true"]')!;
    expect([native.type, native.min, native.max]).toEqual(['datetime-local', '2026-12-01T00:00', '2026-12-31T23:59']);
    type(native, '2026-12-25T18:30');
    click(v.host.querySelector('button[aria-label="Календарь"]'));
    type(field, '');
    expect(answersOf(v.events)).toEqual([{ kind: 'text', value: '2026-12-31T20:00' }, { kind: 'text', value: '2026-12-25T18:30' }, null]);
    v.unmount();
  });

  it('B-17: маска, проверка и обратное преобразование дат', () => {
    expect([maskDate('1a2b', 'time'), maskDate('123456789', 'date'), maskDate('', 'date')]).toEqual(['12', '12.34.5678', '']);
    expect([dateValue('31.02.2026', 'date'), dateValue('29.02.2028', 'date'), dateValue('24:00', 'time'), dateValue('23:59', 'time'), dateValue('31.12.2026', 'datetime'), dateValue('31.12', 'date')]).toEqual([null, '2028-02-29', null, '23:59', null, null]);
    expect([dateText('2026-12-31', 'date'), dateText('20:00', 'time'), dateText('2026-12-31T20:00', 'datetime'), dateText('мусор', 'date')]).toEqual(['31.12.2026', '20:00', '31.12.2026 20:00', '']);
    expect(render(<BlockView block={make('date', { props: { mode: 'time' } })} />).querySelector('input.bk-field')!.getAttribute('placeholder')).toBe('чч:мм');
  });

  it('B-19: контакты — поля с подписями, автозаполнением и одной отправкой после паузы', () => {
    vi.useFakeTimers();
    const ct = make('contacts', { props: { fields: ['name', 'phone', 'email', 'city'] } });
    const v = live([ct]);
    const labels = [...v.host.querySelectorAll('label')].map((l) => l.firstChild?.textContent);
    expect(labels).toEqual(['Имя', 'Телефон', 'Почта', 'Город']);
    const inputs = [...v.host.querySelectorAll('input')];
    expect(inputs.map((i) => i.getAttribute('autocomplete'))).toEqual(['name', 'tel', 'email', 'address-level2']);
    expect(v.host.querySelector('legend')?.textContent).toBe('Контакты');
    type(inputs[0]!, 'Олег');
    type(inputs[1]!, '+79000000000');
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(answersOf(v.events)).toEqual([{ kind: 'contacts', values: { name: 'Олег', phone: '+79000000000' } }]);
    v.unmount();
  });

  it('B-20: согласие — неотмеченный флажок и ссылка на текст согласия', () => {
    const cs = make('consent');
    const v = live([cs], { consentUrl: '/soglasie/abc' });
    const box = v.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(false);
    expect(v.host.querySelector('a')?.getAttribute('href')).toBe('/soglasie/abc');
    click(box);
    expect(answersOf(v.events)).toEqual([{ kind: 'consent', value: true }]);
    v.rerender({ consentUrl: '/soglasie/abc', answers: { [cs.id]: { kind: 'consent', value: true } } });
    click(v.host.querySelector('input[type="checkbox"]'));
    expect(answersOf(v.events).at(-1)).toBeNull();
    v.unmount();
    expect(render(<BlockView block={cs} />).querySelector('a')).toBeNull();
  });
});

describe('B-08, B-09, B-18, B-21…B-23 и PL-21', () => {
  it('B-18 · PL-21: кнопка — роль «кнопка», Enter и пробел нажимают; «требует ответов» ждёт обязательных', () => {
    const btn = make('button', { textLayer: textOf('Дальше') });
    const v = live([btn]);
    const el = v.host.querySelector('[role="button"]')!;
    expect(el.getAttribute('tabindex')).toBe('0');
    key(el, 'Enter');
    key(el, ' ');
    key(el, 'a');
    expect(v.events).toEqual([
      { type: 'tap', blockId: btn.id },
      { type: 'tap', blockId: btn.id },
    ]);
    v.unmount();
    const strict = make('button', { props: { requiresAnswers: true }, states: { disabled: { effects: { opacity: 0.4 } } } });
    const w = live([strict], { requiredMissing: true });
    const sel = w.host.querySelector('[role="button"]')!;
    expect(sel.getAttribute('aria-disabled')).toBe('true');
    expect(sel.getAttribute('data-state')).toBe('disabled');
    click(sel);
    expect(w.events).toEqual([]);
    w.unmount();
  });

  it('PL-21: любой блок с правилом на нажатие — кнопка для клавиатуры; без правил — нет', () => {
    const star = make('shape', { rules: [{ id: 'pravilo01', when: { kind: 'tap', source: { kind: 'block', blockId: 'blok-shape' } }, do: [{ kind: 'goTo', to: 'next' }] }] });
    expect(isPressable(star)).toBe(true);
    expect(isPressable(make('shape'))).toBe(false);
    const v = live([star]);
    expect(v.host.querySelector('[role="button"]')).not.toBeNull();
    v.unmount();
  });

  it('B-08: таймер показывает оставшееся время из движка во всех форматах', () => {
    vi.useFakeTimers();
    let left = 125;
    const t = make('timer', { props: { format: 'mm:ss' } });
    const v = live([t], { timerRemaining: () => left });
    const el = v.host.querySelector('[role="timer"]')!;
    expect(el.textContent).toBe('02:05');
    left = 64.2;
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(el.textContent).toBe('01:05');
    v.unmount();
    expect([formatTimer(3725, 'hh:mm:ss'), formatTimer(9.1, 'seconds'), formatTimer(-3, 'mm:ss'), formatTimer(65, 'words')]).toEqual(['01:02:05', '10', '00:00', '1 минута 5 секунд']);
    expect([durationInWords(0), durationInWords(3600), durationInWords(7322)]).toEqual(['0 секунд', '1 час', '2 часа 2 минуты 2 секунды']);
    expect(render(<BlockView block={make('timer', { props: { seconds: 90 } })} />).querySelector('[role="timer"]')?.textContent).toBe('01:30');
    vi.setSystemTime(new Date('2026-12-31T23:59:00Z'));
    expect(render(<BlockView block={make('timer', { props: { mode: 'until', until: '2027-01-01T00:00:00Z' } })} />).querySelector('[role="timer"]')?.textContent).toBe('01:00');
  });

  it('B-09: прогресс — полоса, точки, «экран N из M» и переменная, с ролью progressbar', () => {
    const bar = render(<BlockView block={make('progress')} />, { progress: { index: 1, total: 4 } }).querySelector('[role="progressbar"]')!;
    expect([bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax'), bar.getAttribute('aria-label')]).toEqual(['2', '4', 'Прогресс прохождения']);
    expect(styleOf(bar.querySelector('.bk-progress-bar'))).toContain('width:50%');
    const dots = render(<BlockView block={make('progress', { props: { variant: 'dots' } })} />, { progress: { index: 2, total: 5 } });
    expect(dots.querySelectorAll('[role="progressbar"] span')).toHaveLength(5);
    expect(render(<BlockView block={make('progress', { props: { variant: 'fraction' } })} />, { progress: { index: 0, total: 3 } }).textContent).toContain('Экран 1 из 3');
    const variable = render(<BlockView block={make('progress', { props: { variant: 'variable', variableId: 'ochki0001', max: 10 } })} />, { variables: { ochki0001: 25 } }).querySelector('[role="progressbar"]')!;
    expect(variable.getAttribute('aria-valuenow')).toBe('10');
  });

  it('B-23: значение переменной — число, текст, значки, время и «7 из 10»', () => {
    const p = (format: string, extra: Record<string, unknown> = {}) => ({ variableId: 'x00001', format, ...extra }) as never;
    expect(formatBlockValue(1234.5, p('number'))).toMatch(/^1\s234,5$/);
    expect(formatBlockValue('Снег', p('text'))).toBe('Снег');
    expect(formatBlockValue(['а', 'б'], p('text'))).toBe('а, б');
    expect(formatBlockValue(3, p('icons'))).toBe('❤❤❤');
    expect(formatBlockValue(2, p('icons', { icon: '⭐', max: 4 }))).toBe('⭐⭐··');
    expect(formatBlockValue(195, p('time'))).toBe('03:15');
    expect(formatBlockValue(7, p('fraction', { max: 10 }))).toBe('7 из 10');
    expect(formatBlockValue(undefined, p('number'))).toBe('0');
    expect(formatBlockValue('abc', p('icons'))).toBe('');
    const shown = render(<BlockView block={make('value', { props: { variableId: 'zhizni001', format: 'icons' } })} />, { variables: { zhizni001: 2 } });
    expect(shown.querySelector('.bk-value')?.textContent).toBe('❤❤');
    expect(render(<BlockView block={make('value', { name: 'Жизни', props: { variableId: 'zhizni001' } })} />).querySelector('.bk-value')?.textContent).toBe('{{Жизни}}');
  });

  it('B-22: видимая зона видна участнику, невидимая — только в редакторе', () => {
    expect(render(<BlockView block={make('zone')} />).querySelector('.bk-zone')?.textContent).toBe('Зона');
    expect(render(<BlockView block={make('zone')} />, { mode: 'player' }).querySelector('.bk-zone')).toBeNull();
    expect(render(<BlockView block={make('zone', { props: { visible: true } })} />, { mode: 'player' }).querySelector('.bk-zone')).not.toBeNull();
  });

  it('B-21 · S-20: в контейнере с раскладкой вложенные блоки идут потоком, в свободной — по координатам', () => {
    const kids = [make('shape', { id: 'kubik00001', frame: { x: 40, y: 50, w: 60, h: 30 } }), make('shape', { id: 'kubik00002', frame: { x: 0, y: 0, w: 60, h: 30 } })];
    const flow = render(<BlockView block={make('container', { style: { layout: { mode: 'row', gap: 6 } }, children: kids })} />);
    const child = styleOf(flow.querySelector('[data-block-id="kubik00001"]'));
    expect(child).toContain('position:relative');
    expect(child).not.toContain('left:');
    expect(child).toContain('width:calc(60 * var(--u))');
    const free = render(<BlockView block={make('container', { children: kids })} />);
    expect(styleOf(free.querySelector('[data-block-id="kubik00001"]'))).toContain('left:calc(40 * var(--u))');
  });

  it('PL-21: фокус с клавиатуры виден — кольцо в цвете темы', () => {
    const host = render(<BlockView block={make('button')} />, { mode: 'player' });
    expect(host.querySelector('style')?.textContent).toContain(`:focus-visible { outline: 3px solid ${DEV_THEMES.light.colors.primary}`);
  });
});

describe('L-07 · B-18: обязательные вопросы в плеере', () => {
  it('L-07: видимые обязательные без ответа мешают, скрытые — нет, контакты требуют согласия', () => {
    const screen = ProjectDocument.parse({ schemaVersion: 1, screens: [{ id: 'ekran1', name: 'Э', blocks: [{ ...createBlock('scale', { id: 'shkala0001', props: { required: true } }) }] }] }).screens[0]!;
    expect(requiredMissing(screen, {}, () => true)).toBe(true);
    expect(requiredMissing(screen, {}, () => false)).toBe(false);
    expect(requiredMissing(screen, { shkala0001: { kind: 'number', value: 3 } }, () => true)).toBe(false);
    const pd = ProjectDocument.parse({ schemaVersion: 1, screens: [{ id: 'ekran2', name: 'Э', blocks: [createBlock('contacts', { id: 'kontakty01' }), createBlock('consent', { id: 'soglasie01' })] }] }).screens[0]!;
    const answers: Record<string, AnswerValue> = { kontakty01: { kind: 'contacts', values: { name: 'Олег', phone: '+79000000000' } } };
    expect(requiredMissing(pd, answers, () => true)).toBe(true);
    expect(requiredMissing(pd, { ...answers, soglasie01: { kind: 'consent', value: true } }, () => true)).toBe(false);
  });

  it('B-11 · B-18: в плеере с движком ответ доходит до движка, кнопка оживает после ответа', () => {
    const q = createBlock('singleChoice', { id: 'vopros0001' }) as Extract<Block, { type: 'singleChoice' }>;
    q.props.required = true;
    const btn = createBlock('button', { id: 'knopka0001', props: { requiresAnswers: true }, states: { disabled: { effects: { opacity: 0.5 } } } });
    const doc = ProjectDocument.parse({ schemaVersion: 1, screens: [{ id: 'ekran1', name: 'Э', blocks: [q, btn] }] });
    const frames = { request: () => 1, cancel: () => undefined };
    const store = new RuntimeStore(createRuntime(doc, { seed: 1 }), () => undefined, frames);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const draw = (node: ReactNode) =>
      act(() => {
        root.render(
          <Artboard mode="player" tokens={DEV_THEMES.light} media={media}>
            {node}
          </Artboard>,
        );
      });
    draw(<PlayerScreen screen={doc.screens[0]!} store={store} progress={{ index: 0, total: 1 }} />);
    expect(host.querySelector('[data-block-id="knopka0001"]')!.getAttribute('aria-disabled')).toBe('true');
    click(host.querySelectorAll('[role="radio"]')[0]!);
    expect(store.runtime.currentAnswers.vopros0001).toEqual({ kind: 'choice', optionIds: [(doc.screens[0]!.blocks[0] as typeof q).props.options[0]!.id] });
    expect(host.querySelectorAll('[role="radio"]')[0]!.getAttribute('aria-checked')).toBe('true');
    expect(host.querySelector('[data-block-id="knopka0001"]')!.getAttribute('aria-disabled')).toBeNull();
    act(() => root.unmount());
  });

  it('B-08: на настоящем движке таймер показывает секунды, а не миллисекунды', () => {
    const timer = createBlock('timer', { id: 'taimer0001', props: { seconds: 90 } });
    const doc = ProjectDocument.parse({ schemaVersion: 1, screens: [{ id: 'ekran1', name: 'Э', blocks: [timer] }] });
    let cb: ((t: number) => void) | null = null;
    const frames = { request: (fn: (t: number) => void) => ((cb = fn), 1), cancel: () => undefined };
    const store = new RuntimeStore(createRuntime(doc, { seed: 1 }), () => undefined, frames);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <Artboard mode="player" tokens={DEV_THEMES.light} media={media}>
          <PlayerScreen screen={doc.screens[0]!} store={store} />
        </Artboard>,
      );
    });
    expect(host.querySelector('[role="timer"]')?.textContent).toBe('01:30');
    act(() => {
      cb?.(1000);
      cb?.(1100);
    });
    expect(store.runtime.timerRemaining('taimer0001')).toBe(89_900);
    act(() => root.unmount());
  });
});

