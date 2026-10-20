import { textOf } from '@blokum/schema';
import { describe, expect, it } from 'vitest';
import { LOOP_WARNING, type Runtime, variablesToRecord } from '../src/index.js';
import { type Outcome, type Step, type World, act, b, bool, buildDoc, ev, is, list, num, on, play, question, rule, tick, txt } from './runtime-helpers.js';

interface Scenario {
  name: string;
  world: World;
  steps: Step[];
  check: (o: Outcome) => void;
}
const sc = (name: string, world: World, steps: Step[], check: (o: Outcome) => void): Scenario => ({ name, world, steps, check });

const K = b('shape', 'knopka');
const K2 = b('shape', 'knopka2', { frame: { x: 100, y: 0, w: 50, h: 50 } });
const S = num('schet01');
const score = (o: Outcome) => o.v('schet01');
const hiddenStar = b('shape', 'zvezda', { initiallyHidden: true, frame: { x: 10, y: 10, w: 40, h: 40 } });
const zone = b('zone', 'korzina', { frame: { x: 200, y: 200, w: 100, h: 100 } });
const gift = b('shape', 'podarok', { frame: { x: 0, y: 0, w: 50, h: 50 } });
const video = b('video', 'rolik1', { props: { media: null } });
const timerBlock = (autoStart = true, seconds = 2) => b('timer', 'taimer', { props: { seconds, autoStart } });
const at = (x: number, y: number) => ({ kind: 'point' as const, point: { x, y } });
const cards = [0, 1, 2, 3].map((i) => b('shape', `karta${i + 1}`, { frame: { x: i * 60, y: 0, w: 50, h: 50 } }));

const scenarios: Scenario[] = [
  // ── TR-01 нажатие ───────────────────────────────────────────────────────────
  sc('TR-01: нажатие на блок увеличивает счёт', { blocks: [K], vars: [S], rules: [rule(on.tap('knopka'), [act.add('schet01')])] }, [ev.tap('knopka'), ev.tap('knopka')], (o) => expect(score(o)).toBe(2)),
  sc(
    'TR-01: нажатие на любую копию блока — копия исчезает',
    { blocks: [hiddenStar], vars: [S], rules: [rule(on.show(), [act.spawn('zvezda', at(100, 100)), act.spawn('zvezda', at(200, 100))]), rule(on.tapCopy('zvezda'), [act.destroy('self'), act.add('schet01')])] },
    [ev.tap('zvezda~1'), ev.tap('zvezda'), ev.tap('zvezda~1')],
    (o) => {
      expect(score(o)).toBe(1);
      expect(o.view('zvezda~1')).toBeUndefined();
      expect(o.view('zvezda~2')?.visible).toBe(true);
    },
  ),
  sc(
    'TR-01: нажатие на любой блок группы',
    { blocks: [b('shape', 'yablok1', { groupId: 'frukty1' }), b('shape', 'yablok2', { groupId: 'frukty1' }), K], vars: [S], rules: [rule(on.tapGroup('frukty1'), [act.add('schet01'), act.hide('self')])] },
    [ev.tap('yablok1'), ev.tap('yablok2'), ev.tap('knopka')],
    (o) => {
      expect(score(o)).toBe(2);
      expect(o.view('yablok2')?.visible).toBe(false);
    },
  ),
  sc('TR-01: скрытый блок не нажимается', { blocks: [hiddenStar], vars: [S], rules: [rule(on.tap('zvezda'), [act.add('schet01')])] }, [ev.tap('zvezda')], (o) => expect(score(o)).toBe(0)),
  sc('TR-01: нажатие на другой блок не вызывает правило', { blocks: [K, K2], vars: [S], rules: [rule(on.tap('knopka'), [act.add('schet01')])] }, [ev.tap('knopka2'), ev.tap('neizvesten')], (o) => expect(score(o)).toBe(0)),

  // ── TR-02 двойное нажатие ───────────────────────────────────────────────────
  sc('TR-02: двойное нажатие', { blocks: [K], vars: [S], rules: [rule(on.doubleTap('knopka'), [act.add('schet01', 10)])] }, [ev.doubleTap('knopka')], (o) => expect(score(o)).toBe(10)),
  sc('TR-02: обычное нажатие не считается двойным', { blocks: [K], vars: [S], rules: [rule(on.doubleTap('knopka'), [act.add('schet01')])] }, [ev.tap('knopka')], (o) => expect(score(o)).toBe(0)),

  // ── TR-03 долгое нажатие ────────────────────────────────────────────────────
  sc('TR-03: удержание дольше порога', { blocks: [K], vars: [S], rules: [rule(on.longPress('knopka', 600), [act.add('schet01')])] }, [ev.longPress('knopka', 800)], (o) => expect(score(o)).toBe(1)),
  sc('TR-03: удержание короче порога', { blocks: [K], vars: [S], rules: [rule(on.longPress('knopka', 600), [act.add('schet01')])] }, [ev.longPress('knopka', 400)], (o) => expect(score(o)).toBe(0)),
  sc(
    'TR-03: из правил с разными порогами срабатывают только достигнутые',
    { blocks: [K], vars: [S], rules: [rule(on.longPress('knopka', 500), [act.add('schet01', 1)]), rule(on.longPress('knopka', 2000), [act.add('schet01', 100)])] },
    [ev.longPress('knopka', 1000)],
    (o) => expect(score(o)).toBe(1),
  ),

  // ── TR-04 наведение ─────────────────────────────────────────────────────────
  sc('TR-04: наведение курсора', { blocks: [K], rules: [rule(on.hover('knopka'), [act.animate('knopka', 'scale', 1.2, 0)])] }, [ev.hover('knopka')], (o) => expect(o.view('knopka')?.anim.scale).toBe(1.2)),
  sc(
    'TR-04: уход курсора',
    { blocks: [K], vars: [S], rules: [rule(on.hover('knopka', 'leave'), [act.add('schet01')])] },
    [ev.hover('knopka'), ev.hover('knopka', 'leave')],
    (o) => expect(score(o)).toBe(1),
  ),

  // ── TR-05 перетаскивание ────────────────────────────────────────────────────
  sc(
    'TR-05: начало перетаскивания — блок «перетаскивается»',
    { blocks: [gift], vars: [S], rules: [rule(on.drag('podarok'), [act.if(is.state('podarok', 'dragging'), [act.add('schet01')])])] },
    [ev.dragStart('podarok'), ev.dragMove('podarok', 30, 40)],
    (o) => {
      expect(score(o)).toBe(1);
      expect(o.view('podarok')).toMatchObject({ dragging: true, x: 30, y: 40 });
    },
  ),
  sc(
    'TR-05: конец перетаскивания',
    { blocks: [gift], vars: [S], rules: [rule(on.drag('podarok', 'end'), [act.add('schet01')])] },
    [ev.dragStart('podarok'), ev.dragEnd('podarok', 10, 10), ev.dragEnd('podarok')],
    (o) => {
      expect(score(o)).toBe(1);
      expect(o.view('podarok')).toMatchObject({ dragging: false, x: 10, y: 10 });
    },
  ),

  // ── TR-06 отпущен на зону ───────────────────────────────────────────────────
  sc(
    'TR-06: подарок отпущен в корзину',
    { blocks: [gift, zone], vars: [S], rules: [rule(on.drop('podarok', 'korzina'), [act.add('schet01'), act.if(is.state('podarok', 'onZone', 'korzina'), [act.add('schet01', 10)])])] },
    [ev.dragStart('podarok'), ev.dragEnd('podarok', 220, 220)],
    (o) => {
      expect(score(o)).toBe(11);
      expect(o.view('podarok')?.zoneId).toBe('korzina');
    },
  ),
  sc(
    'TR-06: отпущен мимо зоны',
    { blocks: [gift, zone], vars: [S], rules: [rule(on.drop('podarok', 'korzina'), [act.add('schet01')])] },
    [ev.dragStart('podarok'), ev.dragEnd('podarok', 0, 0)],
    (o) => {
      expect(score(o)).toBe(0);
      expect(o.view('podarok')?.zoneId).toBeNull();
    },
  ),
  sc(
    'TR-06: копия отпущена на другой блок (не зону)',
    { blocks: [hiddenStar, b('shape', 'mishen1', { frame: { x: 300, y: 300, w: 80, h: 80 } })], vars: [S], rules: [rule(on.show(), [act.spawn('zvezda', at(0, 0))]), rule(on.dropCopy('zvezda', 'mishen1'), [act.add('schet01')])] },
    [ev.dragStart('zvezda~1'), ev.dragEnd('zvezda~1', 310, 310)],
    (o) => {
      expect(score(o)).toBe(1);
      expect(o.view('zvezda~1')?.zoneId).toBeNull();
    },
  ),

  // ── TR-07 пересечение ───────────────────────────────────────────────────────
  sc(
    'TR-07: мяч влетает в ворота — начало пересечения один раз',
    { blocks: [b('shape', 'myach01'), b('shape', 'vorota', { frame: { x: 150, y: 0, w: 50, h: 50 } })], vars: [S], rules: [rule(on.show(), [act.moveTo('myach01', 200, 0, 1000)]), rule(on.collide('myach01', 'vorota'), [act.add('schet01')])] },
    Array.from({ length: 10 }, () => tick(100)),
    (o) => expect(score(o)).toBe(1),
  ),
  sc(
    'TR-07: конец пересечения',
    { blocks: [b('shape', 'myach01'), b('shape', 'vorota', { frame: { x: 150, y: 0, w: 50, h: 50 } })], vars: [S], rules: [rule(on.show(), [act.moveTo('myach01', 200, 0, 1000)]), rule(on.collide('myach01', 'vorota', 'end'), [act.add('schet01')])] },
    Array.from({ length: 12 }, () => tick(100)),
    (o) => expect(score(o)).toBe(1),
  ),
  sc(
    'TR-07: падающие копии ловятся корзиной',
    {
      blocks: [hiddenStar, b('shape', 'lovushka', { frame: { x: 0, y: 300, w: 400, h: 40 } })],
      vars: [S],
      rules: [rule(on.show(), [act.spawn('zvezda', at(0, 0)), act.spawn('zvezda', at(100, 0)), act.spawn('zvezda', at(200, 0))]), rule(on.collideCopies('zvezda', 'lovushka'), [act.add('schet01'), act.destroy('self')])],
    },
    [(rt) => ['zvezda~1', 'zvezda~2', 'zvezda~3'].forEach((id, i) => rt.setMotion(id, { vx: 0, vy: 100 + i * 100 })), ...Array.from({ length: 40 }, () => tick(100))],
    (o) => {
      expect(score(o)).toBe(3);
      expect(o.rt.views().filter((v) => v.copy)).toHaveLength(0);
    },
  ),
  sc(
    'TR-07: скрытые блоки не сталкиваются',
    { blocks: [b('shape', 'myach01', { initiallyHidden: true }), b('shape', 'vorota')], vars: [S], rules: [rule(on.collide('myach01', 'vorota'), [act.add('schet01')])] },
    [tick(16)],
    (o) => expect(score(o)).toBe(0),
  ),

  // ── TR-08 свайп ─────────────────────────────────────────────────────────────
  sc('TR-08: свайп влево по экрану', { vars: [S], rules: [rule(on.swipe('left'), [act.add('schet01')])] }, [ev.swipe('left'), ev.swipe('right')], (o) => expect(score(o)).toBe(1)),
  sc(
    'TR-08: свайп по карточке',
    { blocks: [b('shape', 'kartochka')], vars: [S], rules: [rule(on.swipe('right', 'kartochka'), [act.add('schet01')])] },
    [ev.swipe('right'), ev.swipe('right', 'kartochka')],
    (o) => expect(score(o)).toBe(1),
  ),

  // ── TR-09 показ и уход ──────────────────────────────────────────────────────
  sc('TR-09: при показе экрана', { blocks: [hiddenStar], rules: [rule(on.show(), [act.show('zvezda')])] }, [], (o) => expect(o.view('zvezda')?.visible).toBe(true)),
  sc(
    'TR-09: при уходе с экрана; переход из этого правила не выполняется',
    { vars: [S], rules: [rule(on.leave(), [act.recordVar('счёт', 'schet01'), act.goScreen('ekran2')])] },
    [{ leave: true }, ev.tap('knopka')],
    (o) => {
      expect(o.of('record')).toEqual([{ type: 'record', label: 'счёт', value: 0 }]);
      expect(o.of('navigate')).toEqual([]);
    },
  ),
  sc(
    'TR-09: уход срабатывает и после перехода действием',
    { blocks: [K], vars: [S], rules: [rule(on.tap('knopka'), [act.goNext()]), rule(on.leave(), [act.add('schet01')])] },
    [ev.tap('knopka'), { leave: true }, { leave: true }],
    (o) => expect(score(o)).toBe(1),
  ),
  sc('TR-09: правило всей сборки срабатывает на каждом экране', { vars: [S], docRules: [rule(on.show(), [act.add('schet01')])] }, [{ enter: 'ekran2' }, { enter: 'ekran1' }], (o) => expect(score(o)).toBe(3)),

  // ── TR-10 время ─────────────────────────────────────────────────────────────
  sc(
    'TR-10: через 2 секунды',
    { vars: [S], rules: [rule(on.after(2), [act.add('schet01')])] },
    [tick(1999), (rt) => expect(rt.variables.schet01).toBe(0), tick(1), tick(5000)],
    (o) => expect(score(o)).toBe(1),
  ),
  sc('TR-10: каждую секунду', { vars: [S], rules: [rule(on.every(1), [act.add('schet01')])] }, [tick(3500)], (o) => expect(score(o)).toBe(3)),
  sc(
    'TR-10: истёк таймер B-08',
    { blocks: [timerBlock(true, 2)], vars: [S], rules: [rule(on.timerEnd('taimer'), [act.add('schet01')])] },
    [tick(1999), (rt) => expect(rt.timerRemaining('taimer')).toBe(1), tick(1), tick(3000)],
    (o) => expect(score(o)).toBe(1),
  ),
  sc(
    'TR-10: таймер без автозапуска стартует действием',
    { blocks: [timerBlock(false, 1), K], vars: [S], rules: [rule(on.timerEnd('taimer'), [act.add('schet01')]), rule(on.tap('knopka'), [act.timer('taimer', 'start')])] },
    [tick(5000), ev.tap('knopka'), tick(1000)],
    (o) => expect(score(o)).toBe(1),
  ),
  sc(
    'TR-10: таймеры экрана останавливаются при уходе',
    { vars: [S], rules: [rule(on.every(1), [act.add('schet01')])] },
    [tick(1000), { leave: true }, tick(5000)],
    (o) => expect(score(o)).toBe(1),
  ),

  // ── TR-11 переменная изменилась ─────────────────────────────────────────────
  sc(
    'TR-11: изменилась переменная; то же значение — не изменение',
    { blocks: [K], vars: [S, num('flag01')], rules: [rule(on.tap('knopka'), [act.set('schet01', 5)]), rule(on.change('schet01'), [act.add('flag01')])] },
    [ev.tap('knopka'), ev.tap('knopka')],
    (o) => expect(o.v('flag01')).toBe(1),
  ),
  sc(
    'TR-11: «условие стало истинным» — 3 очка открывают приз',
    { blocks: [K, hiddenStar], vars: [S], rules: [rule(on.tap('knopka'), [act.add('schet01')]), rule(on.change('schet01'), [act.show('zvezda')], { if: is.v('schet01', 'gte', 3) })] },
    [ev.tap('knopka'), ev.tap('knopka'), (rt) => expect(rt.view('zvezda')?.visible).toBe(false), ev.tap('knopka')],
    (o) => expect(o.view('zvezda')?.visible).toBe(true),
  ),

  // ── TR-12 ответ ─────────────────────────────────────────────────────────────
  sc(
    'TR-12: выбран ответ на вопрос',
    { blocks: [question(), hiddenStar], rules: [rule(on.answer(), [act.if(is.selected(1), [act.show('zvezda')], [act.hide('zvezda')])])] },
    [ev.answer(1)],
    (o) => expect(o.view('zvezda')?.visible).toBe(true),
  ),
  sc(
    'TR-12: изменён ответ — правило срабатывает снова',
    { blocks: [question()], vars: [S], rules: [rule(on.answer(), [act.add('schet01')])] },
    [ev.answer(1), ev.answer(2), ev.answer(null)],
    (o) => expect(score(o)).toBe(3),
  ),

  // ── TR-13 медиа закончилось ─────────────────────────────────────────────────
  sc(
    'TR-13: видео закончилось — переход дальше',
    { blocks: [video], rules: [rule(on.show(), [act.media('rolik1', 'play')]), rule(on.mediaEnd('rolik1'), [act.goNext()])] },
    [ev.mediaEnd('rolik1')],
    (o) => {
      expect(o.of('navigate')).toEqual([{ type: 'navigate', to: 'next' }]);
      expect(o.view('rolik1')?.media).toBe('stopped');
    },
  ),
  sc('TR-13: окончание другого медиа не влияет', { blocks: [video, b('audio', 'zvuk01', { props: { media: null } })], vars: [S], rules: [rule(on.mediaEnd('rolik1'), [act.add('schet01')])] }, [ev.mediaEnd('zvuk01'), ev.mediaEnd('net00001')], (o) => expect(score(o)).toBe(0)),

  // ── TR-14 стёрто ────────────────────────────────────────────────────────────
  sc(
    'TR-14: стёрто на 70 % при пороге 60 — один раз',
    { blocks: [b('shape', 'zaschita')], vars: [S], rules: [rule(on.scratched('zaschita', 60), [act.add('schet01')])] },
    [ev.scratched('zaschita', 30), ev.scratched('zaschita', 70), ev.scratched('zaschita', 90)],
    (o) => expect(score(o)).toBe(1),
  ),
  sc('TR-14: стёрто меньше порога', { blocks: [b('shape', 'zaschita')], vars: [S], rules: [rule(on.scratched('zaschita', 80), [act.add('schet01')])] }, [ev.scratched('zaschita', 79)], (o) => expect(score(o)).toBe(0)),

  // ── TR-15 датчики ───────────────────────────────────────────────────────────
  sc('TR-15: встряхивание телефона', { vars: [S], rules: [rule(on.motion('shake'), [act.add('schet01')])] }, [ev.motion('shake'), ev.motion('tiltLeft')], (o) => expect(score(o)).toBe(1)),
  sc(
    'TR-15: наклон влево двигает блок',
    { blocks: [K], rules: [rule(on.motion('tiltLeft'), [act.moveBy('knopka', -10, 0)])] },
    [ev.motion('tiltLeft'), ev.motion('tiltLeft')],
    (o) => expect(o.view('knopka')?.x).toBe(-20),
  ),

  // ── TR-16 клавиши ───────────────────────────────────────────────────────────
  sc('TR-16: нажата клавиша (без учёта регистра)', { vars: [S], rules: [rule(on.key('ArrowLeft'), [act.add('schet01')])] }, [ev.key('arrowleft'), ev.key('ArrowRight')], (o) => expect(score(o)).toBe(1)),
  sc('TR-16: пробел', { vars: [S], rules: [rule(on.key(' '), [act.add('schet01', 5)])] }, [ev.key(' ')], (o) => expect(score(o)).toBe(5)),

  // ── CN-01 переменная ────────────────────────────────────────────────────────
  sc('CN-01: больше — ветка «то»', { blocks: [K], vars: [num('schet01', 7), txt('itog01')], rules: [rule(on.tap('knopka'), [act.if(is.v('schet01', 'gt', 5), [act.set('itog01', 'много')], [act.set('itog01', 'мало')])])] }, [ev.tap('knopka')], (o) => expect(o.v('itog01')).toBe('много')),
  sc('CN-01: меньше — ветка «иначе»', { blocks: [K], vars: [num('schet01', 2), txt('itog01')], rules: [rule(on.tap('knopka'), [act.if(is.v('schet01', 'gt', 5), [act.set('itog01', 'много')], [act.set('itog01', 'мало')])])] }, [ev.tap('knopka')], (o) => expect(o.v('itog01')).toBe('мало')),
  sc('CN-01: список содержит', { blocks: [K], vars: [list('korzina', ['ёлка', 'шар']), S], rules: [rule(on.tap('knopka'), [act.add('schet01')], { if: is.v('korzina', 'contains', 'Шар') })] }, [ev.tap('knopka')], (o) => expect(score(o)).toBe(1)),
  sc('CN-01: пустой текст', { blocks: [K], vars: [txt('imya01'), S], rules: [rule(on.tap('knopka'), [act.add('schet01')], { if: is.v('imya01', 'empty') })] }, [ev.tap('knopka')], (o) => expect(score(o)).toBe(1)),
  sc('CN-01: равно и не равно', { blocks: [K], vars: [txt('cvet01', 'красный'), S], rules: [rule(on.tap('knopka'), [act.if(is.v('cvet01', 'eq', 'КРАСНЫЙ'), [act.add('schet01')]), act.if(is.v('cvet01', 'ne', 'синий'), [act.add('schet01', 10)])])] }, [ev.tap('knopka')], (o) => expect(score(o)).toBe(11)),

  // ── CN-02 ответ ─────────────────────────────────────────────────────────────
  sc('CN-02: выбран вариант', { blocks: [question(), K], vars: [S], rules: [rule(on.tap('knopka'), [act.add('schet01')], { if: is.selected(2) })] }, [ev.tap('knopka'), ev.answer(2), ev.tap('knopka')], (o) => expect(score(o)).toBe(1)),
  sc('CN-02: вариант не выбран', { blocks: [question(), K], vars: [S], rules: [rule(on.tap('knopka'), [act.add('schet01')], { if: { kind: 'answer', questionBlockId: 'vopros', op: 'notSelected', optionId: 'vopros_otvet1' } })] }, [ev.answer(2), ev.tap('knopka')], (o) => expect(score(o)).toBe(1)),
  sc(
    'CN-02: правильность по вердикту сервера',
    { blocks: [question(), K], vars: [S], rules: [rule(on.tap('knopka'), [act.if(is.answer('correct'), [act.add('schet01')], [act.add('schet01', -1)])])] },
    [ev.answer(1), (rt) => rt.setVerdict('vopros', { correct: true, score: 3 }), ev.tap('knopka')],
    (o) => expect(score(o)).toBe(1),
  ),
  sc(
    'CN-02: баллы за ответ по вердикту сервера',
    { blocks: [question(), K], vars: [S], rules: [rule(on.tap('knopka'), [act.add('schet01')], { if: is.answer('scoreGte', 3) })] },
    [ev.answer(1), (rt) => rt.setVerdict('vopros', { correct: null, score: 5 }), ev.tap('knopka')],
    (o) => expect(score(o)).toBe(1),
  ),
  sc(
    'CN-02: без вердикта ключа в браузере нет — «верно» ложно (PL-15)',
    { blocks: [question(), K], vars: [S], rules: [rule(on.tap('knopka'), [act.if(is.answer('correct'), [act.add('schet01')], [act.add('schet01', -1)])])] },
    [ev.answer(1), ev.tap('knopka')],
    (o) => expect(score(o)).toBe(-1),
  ),
  sc('CN-02: ответ пуст', { blocks: [question(), K], vars: [S], rules: [rule(on.tap('knopka'), [act.add('schet01')], { if: is.answer('empty') })] }, [ev.tap('knopka'), ev.answer(1), ev.tap('knopka')], (o) => expect(score(o)).toBe(1)),

  // ── CN-03 состояние блока ───────────────────────────────────────────────────
  sc(
    'CN-03: видим / скрыт',
    { blocks: [K, hiddenStar], vars: [S], rules: [rule(on.tap('knopka'), [act.if(is.state('zvezda', 'hidden'), [act.add('schet01')]), act.show('zvezda'), act.if(is.state('zvezda', 'visible'), [act.add('schet01', 10)])])] },
    [ev.tap('knopka')],
    (o) => expect(score(o)).toBe(11),
  ),
  sc(
    'CN-03: вариант ответа выбран',
    { blocks: [question(), K], vars: [S], rules: [rule(on.tap('knopka'), [act.add('schet01')], { if: is.state('vopros_variant1', 'selected') })] },
    [ev.answer(1), ev.tap('knopka')],
    (o) => {
      expect(score(o)).toBe(1);
      expect(o.view('vopros_variant1')?.selected).toBe(true);
      expect(o.view('vopros_variant2')?.selected).toBe(false);
    },
  ),
  sc(
    'CN-03: блок на любой зоне',
    { blocks: [gift, zone, K], vars: [S], rules: [rule(on.tap('knopka'), [act.add('schet01')], { if: is.state('podarok', 'onZone') })] },
    [ev.tap('knopka'), ev.dragStart('podarok'), ev.dragEnd('podarok', 230, 230), ev.tap('knopka')],
    (o) => expect(score(o)).toBe(1),
  ),
  sc(
    'CN-03: сколько копий существует',
    { blocks: [hiddenStar, K], vars: [S], rules: [rule(on.tap('knopka'), [act.spawn('zvezda', at(0, 0)), act.if(is.copies('zvezda', 'gte', 3), [act.add('schet01')])])] },
    [ev.tap('knopka'), ev.tap('knopka'), ev.tap('knopka'), ev.tap('knopka')],
    (o) => expect(score(o)).toBe(2),
  ),
  sc('CN-03: удалённый блок считается скрытым', { blocks: [K, K2], vars: [S], rules: [rule(on.tap('knopka'), [act.destroy('knopka2'), act.if(is.state('knopka2', 'hidden'), [act.add('schet01')])])] }, [ev.tap('knopka')], (o) => expect(score(o)).toBe(1)),

  // ── CN-04 счётчик срабатываний ──────────────────────────────────────────────
  sc('CN-04: на 3-й раз', { blocks: [K, hiddenStar], rules: [rule(on.tap('knopka'), [act.show('zvezda')], { if: is.count('eq', 3) })] }, [ev.tap('knopka'), ev.tap('knopka'), (rt) => expect(rt.view('zvezda')?.visible).toBe(false), ev.tap('knopka')], (o) => expect(o.view('zvezda')?.visible).toBe(true)),
  sc('CN-04: только первые разы', { blocks: [K], vars: [S], rules: [rule(on.tap('knopka'), [act.add('schet01')], { if: is.count('lt', 3) })] }, [ev.tap('knopka'), ev.tap('knopka'), ev.tap('knopka'), ev.tap('knopka')], (o) => expect(score(o)).toBe(2)),

  // ── CN-05 случайно ──────────────────────────────────────────────────────────
  sc('CN-05: влияющее на результат — из серверного источника (выпало)', { blocks: [K], vars: [S], random: 0.1, rules: [rule(on.tap('knopka'), [act.add('schet01')], { if: is.chance(50, true) })] }, [ev.tap('knopka')], (o) => expect(score(o)).toBe(1)),
  sc('CN-05: влияющее на результат — не выпало', { blocks: [K], vars: [S], random: 0.9, rules: [rule(on.tap('knopka'), [act.add('schet01')], { if: is.chance(50, true) })] }, [ev.tap('knopka')], (o) => expect(score(o)).toBe(0)),
  sc(
    'CN-05: косметическая случайность — из seed, 0 % и 100 %',
    { blocks: [K], vars: [S], seed: 9, rules: [rule(on.tap('knopka'), [act.if(is.chance(0), [act.add('schet01', 100)]), act.if(is.chance(100), [act.add('schet01')])])] },
    [ev.tap('knopka'), ev.tap('knopka')],
    (o) => expect(score(o)).toBe(2),
  ),

  // ── CN-06 группы и вложенные «Если/Иначе» ──────────────────────────────────
  sc('CN-06: И', { blocks: [K], vars: [num('aaaaaa', 1), num('bbbbbb', 2), S], rules: [rule(on.tap('knopka'), [act.add('schet01')], { if: is.and(is.v('aaaaaa', 'eq', 1), is.v('bbbbbb', 'eq', 2)) })] }, [ev.tap('knopka')], (o) => expect(score(o)).toBe(1)),
  sc('CN-06: ИЛИ', { blocks: [K], vars: [num('aaaaaa', 1), S], rules: [rule(on.tap('knopka'), [act.add('schet01')], { if: is.or(is.v('aaaaaa', 'eq', 5), is.v('aaaaaa', 'eq', 1)) })] }, [ev.tap('knopka')], (o) => expect(score(o)).toBe(1)),
  sc('CN-06: НЕ', { blocks: [K], vars: [num('aaaaaa', 1), S], rules: [rule(on.tap('knopka'), [act.add('schet01')], { if: is.not(is.v('aaaaaa', 'eq', 1)) })] }, [ev.tap('knopka')], (o) => expect(score(o)).toBe(0)),
  sc(
    'CN-06: вложенные «Если / Иначе»',
    {
      blocks: [K],
      vars: [num('aaaaaa', 2), txt('itog01')],
      rules: [rule(on.tap('knopka'), [act.if(is.v('aaaaaa', 'gt', 0), [act.if(is.v('aaaaaa', 'gt', 1), [act.set('itog01', 'больше одного')], [act.set('itog01', 'один')])], [act.set('itog01', 'ноль')])])],
    },
    [ev.tap('knopka')],
    (o) => expect(o.v('itog01')).toBe('больше одного'),
  ),
  sc(
    'CN-06: «Если» внутри «Повторить»',
    { blocks: [K], vars: [S, num('chet01')], rules: [rule(on.tap('knopka'), [act.repeat(6, [act.add('schet01'), act.if(is.or(is.v('schet01', 'eq', 2), is.v('schet01', 'eq', 4), is.v('schet01', 'eq', 6)), [act.add('chet01')])])])] },
    [ev.tap('knopka')],
    (o) => expect([score(o), o.v('chet01')]).toEqual([6, 3]),
  ),

  // ── AC-01 показать / скрыть ─────────────────────────────────────────────────
  sc('AC-01: скрыть блок', { blocks: [K], rules: [rule(on.tap('knopka'), [act.hide('knopka')])] }, [ev.tap('knopka')], (o) => expect(o.view('knopka')).toMatchObject({ visible: false, animateVisibility: true })),
  sc('AC-01: показать скрытый блок', { blocks: [K, hiddenStar], rules: [rule(on.tap('knopka'), [act.show('zvezda')])] }, [ev.tap('knopka')], (o) => expect(o.view('zvezda')?.visible).toBe(true)),
  sc('AC-01: переключить без анимации', { blocks: [K, K2], rules: [rule(on.tap('knopka'), [act.toggle('knopka2')])] }, [ev.tap('knopka'), ev.tap('knopka'), ev.tap('knopka')], (o) => expect(o.view('knopka2')).toMatchObject({ visible: false, animateVisibility: false })),
  sc(
    'AC-01: скрытый контейнер скрывает вложенные блоки от нажатий',
    { blocks: [K, b('container', 'konteiner', { children: [b('shape', 'vnutri1')] })], vars: [S], rules: [rule(on.tap('knopka'), [act.hide('konteiner')]), rule(on.tap('vnutri1'), [act.add('schet01')])] },
    [ev.tap('vnutri1'), ev.tap('knopka'), ev.tap('vnutri1')],
    (o) => expect(score(o)).toBe(1),
  ),
  sc(
    'AC-01: скрыть все копии',
    { blocks: [hiddenStar, K], rules: [rule(on.show(), [act.spawn('zvezda', at(0, 0)), act.spawn('zvezda', at(60, 0))]), rule(on.tap('knopka'), [act.hide('*zvezda')])] },
    [ev.tap('knopka')],
    (o) => expect(o.rt.views().filter((v) => v.copy).map((v) => v.visible)).toEqual([false, false]),
  ),

  // ── AC-02 изменить любое свойство ───────────────────────────────────────────
  sc(
    'AC-02: цвет заливки',
    { blocks: [K], rules: [rule(on.tap('knopka'), [act.prop('knopka', 'style.fills', [{ kind: 'solid', color: { hex: '#FF0000' } }])])] },
    [ev.tap('knopka')],
    (o) => expect(o.view('knopka')?.overrides['style.fills']).toMatchObject([{ kind: 'solid', color: { hex: '#FF0000' } }]),
  ),
  sc(
    'AC-02: ширина плавно за 1 с',
    { blocks: [K], rules: [rule(on.tap('knopka'), [{ kind: 'setProperty', target: { kind: 'self' }, property: 'frame.w', value: 150, durationMs: 1000, easing: { kind: 'preset', name: 'linear' } }])] },
    [ev.tap('knopka'), tick(500), (rt) => expect(rt.view('knopka')?.w).toBe(100), tick(600)],
    (o) => expect(o.view('knopka')?.w).toBe(150),
  ),
  sc(
    'AC-02: недопустимое значение не применяется',
    { blocks: [K], rules: [rule(on.tap('knopka'), [act.prop('knopka', 'style.fills', 'красный'), act.prop('knopka', 'frame.w', -5)])] },
    [ev.tap('knopka')],
    (o) => {
      expect(o.warnings).toEqual(['Недопустимое значение свойства style.fills', 'Недопустимое значение свойства frame.w']);
      expect(o.view('knopka')?.overrides).toEqual({});
    },
  ),
  sc('AC-02: текст блока', { blocks: [K], rules: [rule(on.tap('knopka'), [act.prop('self', 'textLayer', textOf('Нажато!'))])] }, [ev.tap('knopka')], (o) => expect(o.view('knopka')?.overrides.textLayer).toEqual(textOf('Нажато!'))),
  sc(
    'AC-02: форма, поворот и отражение сразу',
    { blocks: [K], rules: [rule(on.tap('knopka'), [act.prop('knopka', 'style.shape', { kind: 'star' }), act.prop('knopka', 'frame.rotation', 45), act.prop('knopka', 'frame.flipX', true)])] },
    [ev.tap('knopka')],
    (o) => expect(o.view('knopka')).toMatchObject({ rotation: 45, overrides: { 'style.shape': { kind: 'star', points: 5 }, 'frame.flipX': true } }),
  ),
  sc('AC-02: плавная прозрачность', { blocks: [K], rules: [rule(on.tap('knopka'), [act.animate('knopka', 'opacity', 0, 1000)])] }, [ev.tap('knopka'), tick(250)], (o) => expect(o.view('knopka')?.anim.opacity).toBeCloseTo(0.75)),
  sc(
    'AC-02: новый набор эффектов сбрасывает анимированную прозрачность',
    { blocks: [K], rules: [rule(on.tap('knopka'), [act.animate('knopka', 'opacity', 0.2, 0), act.prop('knopka', 'style.effects', { opacity: 0.7 })]), rule(on.doubleTap('knopka'), [act.animate('knopka', 'opacity', 0, 1000)])] },
    [ev.tap('knopka'), ev.doubleTap('knopka'), tick(500)],
    (o) => expect(o.view('knopka')?.anim.opacity).toBeCloseTo(0.35),
  ),

  // ── AC-03 переместить ───────────────────────────────────────────────────────
  sc('AC-03: в точку', { blocks: [K], rules: [rule(on.tap('knopka'), [act.moveTo('knopka', 120, 300)])] }, [ev.tap('knopka')], (o) => expect(o.view('knopka')).toMatchObject({ x: 120, y: 300 })),
  sc('AC-03: на N единиц плавно', { blocks: [K], rules: [rule(on.tap('knopka'), [act.moveBy('knopka', 100, 0, 400)])] }, [ev.tap('knopka'), tick(400)], (o) => expect(o.view('knopka')?.x).toBe(100)),
  sc('AC-03: к другому блоку (центр к центру)', { blocks: [K, b('shape', 'cel001', { frame: { x: 300, y: 300, w: 100, h: 100 } })], rules: [rule(on.tap('knopka'), [act.moveToBlock('knopka', 'cel001')])] }, [ev.tap('knopka')], (o) => expect(o.view('knopka')).toMatchObject({ x: 325, y: 325 })),
  sc(
    'AC-03: случайно в области — внутри области',
    { blocks: [K], rules: [rule(on.tap('knopka'), [act.moveRandom('knopka', { x: 100, y: 100, w: 200, h: 100 })])] },
    Array.from({ length: 20 }, () => ev.tap('knopka')),
    (o) => {
      const v = o.view('knopka')!;
      expect(v.x).toBeGreaterThanOrEqual(100);
      expect(v.x).toBeLessThanOrEqual(250);
      expect(v.y).toBeGreaterThanOrEqual(100);
      expect(v.y).toBeLessThanOrEqual(150);
    },
  ),
  sc(
    'AC-03: вложенный блок в точку экрана — с учётом контейнера',
    { blocks: [K, b('container', 'konteiner', { frame: { x: 100, y: 100, w: 200, h: 200 }, children: [b('shape', 'vnutri1')] })], rules: [rule(on.tap('knopka'), [act.moveTo('vnutri1', 150, 150)])] },
    [ev.tap('knopka')],
    (o) => expect(o.view('vnutri1')).toMatchObject({ x: 50, y: 50 }),
  ),

  // ── AC-04 изменить переменную ───────────────────────────────────────────────
  sc(
    'AC-04: = + − × ÷',
    { blocks: [K], vars: [S], rules: [rule(on.tap('knopka'), [act.set('schet01', 10), act.op('schet01', 'add', 5), act.op('schet01', 'sub', 3), act.op('schet01', 'mul', 2), act.op('schet01', 'div', 4)])] },
    [ev.tap('knopka')],
    (o) => expect(score(o)).toBe(6),
  ),
  sc('AC-04: деление на ноль не меняет значение', { blocks: [K], vars: [num('schet01', 5)], rules: [rule(on.tap('knopka'), [act.op('schet01', 'div', 0)])] }, [ev.tap('knopka')], (o) => {
    expect(score(o)).toBe(5);
    expect(o.warnings).toEqual(['Переменная «schet01»: Деление на ноль']);
  }),
  sc(
    'AC-04: случайное целое в диапазоне',
    { blocks: [K], vars: [S, list('vypalo', [])], rules: [rule(on.tap('knopka'), [act.op('schet01', 'random', undefined, [1, 6]), act.op('vypalo', 'append', 0)])] },
    Array.from({ length: 30 }, () => ev.tap('knopka')),
    (o) => {
      const v = score(o) as number;
      expect(Number.isInteger(v) && v >= 1 && v <= 6).toBe(true);
    },
  ),
  sc('AC-04: текст дописывается', { blocks: [K], vars: [txt('slovo1', 'Ё')], rules: [rule(on.tap('knopka'), [act.op('slovo1', 'append', 'лка')])] }, [ev.tap('knopka')], (o) => expect(o.v('slovo1')).toBe('Ёлка')),
  sc('AC-04: переключить да/нет', { blocks: [K], vars: [bool('vkl001')], rules: [rule(on.tap('knopka'), [act.op('vkl001', 'toggle')])] }, [ev.tap('knopka'), ev.tap('knopka'), ev.tap('knopka')], (o) => expect(o.v('vkl001')).toBe(true)),
  sc('AC-04: да/нет из текста «да»', { blocks: [K], vars: [bool('vkl001')], rules: [rule(on.tap('knopka'), [act.set('vkl001', 'да')])] }, [ev.tap('knopka')], (o) => expect(o.v('vkl001')).toBe(true)),
  sc(
    'AC-04: добавить в список и убрать из списка',
    { blocks: [K], vars: [list('korzina', ['шар'])], rules: [rule(on.tap('knopka'), [act.op('korzina', 'append', 'ёлка'), act.op('korzina', 'append', 3), act.op('korzina', 'remove', 'шар')])] },
    [ev.tap('knopka')],
    (o) => expect(o.v('korzina')).toEqual(['ёлка', 3]),
  ),
  sc(
    'AC-04: случайный элемент списка',
    { blocks: [K], vars: [list('podarki', ['кот', 'пёс', 'ёж']), txt('vybor1')], rules: [rule(on.tap('knopka'), [act.op('vybor1', 'pickRandom', 'podarki')])] },
    [ev.tap('knopka')],
    (o) => expect(['кот', 'пёс', 'ёж']).toContain(o.v('vybor1')),
  ),
  sc('AC-04: текст в числовую переменную не записывается', { blocks: [K], vars: [S], rules: [rule(on.tap('knopka'), [act.set('schet01', 'много')])] }, [ev.tap('knopka')], (o) => {
    expect(score(o)).toBe(0);
    expect(o.warnings).toEqual(['Переменная «schet01»: Для числовой переменной нужно число']);
  }),
  sc(
    'AC-04: перемешать список',
    { blocks: [K], vars: [list('koloda1', [1, 2, 3, 4, 5, 6])], rules: [rule(on.tap('knopka'), [act.op('koloda1', 'random')])] },
    [ev.tap('knopka')],
    (o) => expect([...(o.v('koloda1') as number[])].sort()).toEqual([1, 2, 3, 4, 5, 6]),
  ),

  // ── AC-05 перейти ───────────────────────────────────────────────────────────
  sc(
    'AC-05: следующий экран — остальные действия и нажатия уже не выполняются',
    { blocks: [K], vars: [S], rules: [rule(on.tap('knopka'), [act.goNext(), act.add('schet01')])] },
    [ev.tap('knopka'), ev.tap('knopka')],
    (o) => {
      expect(o.of('navigate')).toEqual([{ type: 'navigate', to: 'next' }]);
      expect(score(o)).toBe(0);
    },
  ),
  sc(
    'AC-05: на экран X с переходом',
    { blocks: [K], rules: [rule(on.tap('knopka'), [{ kind: 'goTo', to: 'screen', screenId: 'ekran2', transition: { kind: 'zoom' } }])] },
    [ev.tap('knopka')],
    (o) => expect(o.of('navigate')[0]).toMatchObject({ to: 'screen', screenId: 'ekran2', transition: { kind: 'zoom' } }),
  ),
  sc('AC-05: назад и по ветвлению', { blocks: [K, K2], rules: [rule(on.tap('knopka'), [act.goBack()]), rule(on.tap('knopka2'), [{ kind: 'goTo', to: 'branch' }])] }, [ev.tap('knopka2')], (o) => expect(o.of('navigate')).toEqual([{ type: 'navigate', to: 'branch' }])),
  sc(
    'AC-05: после входа на новый экран события снова принимаются',
    { blocks: [K], vars: [S], rules: [rule(on.tap('knopka'), [act.goBack()])], screen2: { blocks: [b('shape', 'knopka3')], rules: [rule(on.tap('knopka3'), [act.add('schet01')])] } },
    [ev.tap('knopka'), { enter: 'ekran2' }, ev.tap('knopka3')],
    (o) => {
      expect(o.of('navigate')).toEqual([{ type: 'navigate', to: 'back' }]);
      expect(score(o)).toBe(1);
    },
  ),

  // ── AC-06 медиа ─────────────────────────────────────────────────────────────
  sc('AC-06: проиграть видео', { blocks: [video, K], rules: [rule(on.tap('knopka'), [act.media('rolik1', 'play')])] }, [ev.tap('knopka')], (o) => {
    expect(o.view('rolik1')?.media).toBe('playing');
    expect(o.of('media')).toEqual([{ type: 'media', blockId: 'rolik1', command: 'play' }]);
  }),
  sc('AC-06: пауза и перезапуск', { blocks: [video, K, K2], rules: [rule(on.tap('knopka'), [act.media('rolik1', 'pause')]), rule(on.tap('knopka2'), [act.media('rolik1', 'restart')])] }, [ev.tap('knopka'), (rt) => expect(rt.view('rolik1')?.media).toBe('paused'), ev.tap('knopka2')], (o) =>
    expect(o.view('rolik1')?.media).toBe('playing'),
  ),
  sc('AC-06: звук без блока', { blocks: [K], rules: [rule(on.tap('knopka'), [act.sound()])] }, [ev.tap('knopka')], (o) => expect(o.of('playSound')).toEqual([{ type: 'playSound', media: { source: 'media', id: 'zvukfail01' } }])),
  sc('AC-06: остановить', { blocks: [video, K], rules: [rule(on.show(), [act.media('rolik1', 'play')]), rule(on.tap('knopka'), [act.media('rolik1', 'stop')])] }, [ev.tap('knopka')], (o) => expect(o.view('rolik1')?.media).toBe('stopped')),

  // ── AC-07 эффект ────────────────────────────────────────────────────────────
  sc('AC-07: конфетти', { blocks: [K], rules: [rule(on.tap('knopka'), [act.effect('confetti')])] }, [ev.tap('knopka')], (o) => expect(o.of('effect')).toEqual([{ type: 'effect', effect: 'confetti', intensity: 1 }])),
  sc('AC-07: всплеск частиц в центре блока и вибрация', { blocks: [K2], rules: [rule(on.tap('knopka2'), [act.effect('burst', 'self'), act.effect('vibrate')])] }, [ev.tap('knopka2')], (o) =>
    expect(o.of('effect')).toEqual([
      { type: 'effect', effect: 'burst', intensity: 1, at: { x: 125, y: 25 } },
      { type: 'effect', effect: 'vibrate', intensity: 1 },
    ]),
  ),

  // ── AC-08 медиа-вставка ─────────────────────────────────────────────────────
  sc('AC-08: мем с подписью', { blocks: [K], rules: [rule(on.tap('knopka'), [act.meme('Ну ты даёшь!')])] }, [ev.tap('knopka')], (o) => expect(o.of('mediaOverlay')[0]?.overlay).toMatchObject({ seconds: 1.5, caption: { text: 'Ну ты даёшь!' } })),
  sc(
    'AC-08: мем после паузы и переход',
    { blocks: [K], rules: [rule(on.tap('knopka'), [act.meme('Хо-хо-хо'), act.wait(1500), act.goNext()])] },
    [ev.tap('knopka'), tick(1000), (rt) => expect(rt.now).toBe(1000), tick(500)],
    (o) => expect(o.effects.map((e) => e.type)).toEqual(['mediaOverlay', 'navigate']),
  ),

  // ── AC-09 создать копию ─────────────────────────────────────────────────────
  sc('AC-09: копия в точке', { blocks: [hiddenStar, K], rules: [rule(on.tap('knopka'), [act.spawn('zvezda', at(150, 250))])] }, [ev.tap('knopka')], (o) => {
    expect(o.view('zvezda~1')).toMatchObject({ x: 150, y: 250, w: 40, h: 40, copy: true, protoId: 'zvezda', visible: true });
    expect(o.steps[1]?.spawned).toEqual(['zvezda~1']);
  }),
  sc('AC-09: лимит копий одного образца', { blocks: [hiddenStar, K], rules: [rule(on.tap('knopka'), [act.spawn('zvezda', at(0, 0), 3)])] }, Array.from({ length: 5 }, () => ev.tap('knopka')), (o) =>
    expect(o.rt.views().filter((v) => v.copy)).toHaveLength(3),
  ),
  sc(
    'AC-09: случайно в области',
    { blocks: [hiddenStar, K], rules: [rule(on.tap('knopka'), [act.spawn('zvezda', { kind: 'randomIn', area: { x: 0, y: 500, w: 390, h: 100 } })])] },
    Array.from({ length: 10 }, () => ev.tap('knopka')),
    (o) => {
      for (const v of o.rt.views().filter((x) => x.copy)) {
        expect(v.x).toBeGreaterThanOrEqual(0);
        expect(v.x + v.w).toBeLessThanOrEqual(390);
        expect(v.y).toBeGreaterThanOrEqual(500);
        expect(v.y + v.h).toBeLessThanOrEqual(600);
      }
    },
  ),
  sc('AC-09: со смещением от образца и у другого блока', { blocks: [hiddenStar, K, b('shape', 'cel001', { frame: { x: 300, y: 300, w: 100, h: 100 } })], rules: [rule(on.tap('knopka'), [act.spawn('zvezda', { kind: 'by', dx: 5, dy: 0 }), act.spawn('zvezda', { kind: 'block', blockId: 'cel001' })])] }, [ev.tap('knopka')], (o) => {
    expect(o.view('zvezda~1')).toMatchObject({ x: 15, y: 10 });
    expect(o.view('zvezda~2')).toMatchObject({ x: 330, y: 330 });
  }),
  sc('AC-09: не больше 200 копий на экране', { blocks: [hiddenStar, K], rules: [rule(on.tap('knopka'), [act.repeat(250, [act.spawn('zvezda', at(0, 0), 200), act.spawn('knopka2', at(0, 0), 200)])])] }, [ev.tap('knopka')], (o) => {
    expect(o.rt.views().filter((v) => v.copy)).toHaveLength(200);
    expect(o.warnings.filter((w) => w.includes('200 копий'))).toHaveLength(1);
  }),
  sc('AC-09: копия контейнера копирует вложенные блоки', { blocks: [b('container', 'konteiner', { children: [b('shape', 'vnutri1')] }), K], rules: [rule(on.tap('knopka'), [act.spawn('konteiner', at(200, 0))])] }, [ev.tap('knopka')], (o) => {
    expect(o.view('vnutri1~1')).toMatchObject({ copy: true, protoId: 'vnutri1', parentId: 'konteiner~1' });
    expect(o.steps[1]?.spawned).toEqual(['konteiner~1', 'vnutri1~1']);
  }),
  sc('AC-09: образец с другого экрана не копируется', { blocks: [K], rules: [rule(on.tap('knopka'), [act.spawn('netakogo', at(0, 0))])] }, [ev.tap('knopka')], (o) => expect(o.warnings).toEqual(['Создать копию: образец не найден на экране'])),

  // ── AC-10 удалить ───────────────────────────────────────────────────────────
  sc('AC-10: удалить блок', { blocks: [K, K2], rules: [rule(on.tap('knopka'), [act.destroy('knopka2')])] }, [ev.tap('knopka')], (o) => {
    expect(o.view('knopka2')).toBeUndefined();
    expect(o.rt.views().map((v) => v.id)).toEqual(['knopka']);
    expect(o.steps[1]?.destroyed).toEqual(['knopka2']);
  }),
  sc('AC-10: удалить все копии', { blocks: [hiddenStar, K], rules: [rule(on.show(), [act.repeat(3, [act.spawn('zvezda', at(0, 0))])]), rule(on.tap('knopka'), [act.destroy('*zvezda')])] }, [ev.tap('knopka')], (o) => expect(o.rt.views().filter((v) => v.copy)).toHaveLength(0)),

  // ── AC-11 подождать ─────────────────────────────────────────────────────────
  sc(
    'AC-11: показать, подождать 1 с, показать следующее',
    { blocks: [K, b('shape', 'odin01', { initiallyHidden: true }), b('shape', 'dva002', { initiallyHidden: true })], rules: [rule(on.tap('knopka'), [act.show('odin01'), act.wait(1000), act.show('dva002')])] },
    [ev.tap('knopka'), tick(999), (rt) => expect([rt.view('odin01')?.visible, rt.view('dva002')?.visible]).toEqual([true, false]), tick(1)],
    (o) => expect(o.view('dva002')?.visible).toBe(true),
  ),
  sc(
    'AC-11: две паузы подряд в одном тике',
    { blocks: [K], vars: [S], rules: [rule(on.tap('knopka'), [act.wait(100), act.add('schet01'), act.wait(100), act.add('schet01')])] },
    [ev.tap('knopka'), tick(1000)],
    (o) => expect(score(o)).toBe(2),
  ),
  sc('AC-11: уход с экрана отменяет отложенные действия', { blocks: [K], vars: [S], rules: [rule(on.tap('knopka'), [act.wait(500), act.add('schet01')])] }, [ev.tap('knopka'), { enter: 'ekran2' }, tick(1000)], (o) => expect(score(o)).toBe(0)),

  // ── AC-12 повторить ─────────────────────────────────────────────────────────
  sc('AC-12: повторить 5 раз', { blocks: [K], vars: [S], rules: [rule(on.tap('knopka'), [act.repeat(5, [act.add('schet01')])])] }, [ev.tap('knopka')], (o) => expect(score(o)).toBe(5)),
  sc('AC-12: пока выполняется условие', { blocks: [K], vars: [num('schet01', 1)], rules: [rule(on.tap('knopka'), [act.repeat(undefined, [act.op('schet01', 'mul', 2)], is.v('schet01', 'lt', 100))])] }, [ev.tap('knopka')], (o) => expect(score(o)).toBe(128)),
  sc(
    'AC-12: повтор с паузой внутри',
    { blocks: [K], vars: [S], rules: [rule(on.tap('knopka'), [act.repeat(3, [act.add('schet01'), act.wait(500)])])] },
    [ev.tap('knopka'), (rt) => expect(rt.variables.schet01).toBe(1), tick(500), (rt) => expect(rt.variables.schet01).toBe(2), tick(500)],
    (o) => expect(score(o)).toBe(3),
  ),
  sc(
    'AC-12: бесконечный «пока» останавливается защитой SC-04',
    { blocks: [K], vars: [S], rules: [rule(on.tap('knopka'), [act.repeat(undefined, [act.add('schet01')], is.v('schet01', 'gte', 0))], { name: 'Вечный' })] },
    [ev.tap('knopka')],
    (o) => {
      expect(score(o)).toBeLessThan(1000);
      expect(o.warnings).toEqual([`${LOOP_WARNING}: правило «Вечный» остановлено (больше 1000 действий за секунду)`]);
    },
  ),

  // ── AC-13 таймер ────────────────────────────────────────────────────────────
  sc('AC-13: остановить таймер', { blocks: [timerBlock(true, 10), K], rules: [rule(on.tap('knopka'), [act.timer('taimer', 'stop')])] }, [tick(1000), ev.tap('knopka'), tick(3000)], (o) => expect(o.rt.timerRemaining('taimer')).toBe(9000)),
  sc('AC-13: сбросить и запустить', { blocks: [timerBlock(true, 2), K], vars: [S], rules: [rule(on.timerEnd('taimer'), [act.add('schet01')]), rule(on.tap('knopka'), [act.timer('taimer', 'reset'), act.timer('taimer', 'start')])] }, [tick(2000), ev.tap('knopka'), tick(1000), (rt) => expect(rt.timerRemaining('taimer')).toBe(1000), tick(1000)], (o) =>
    expect(score(o)).toBe(2),
  ),

  // ── AC-14 записать в ответы ─────────────────────────────────────────────────
  sc('AC-14: записать переменную', { blocks: [K], vars: [num('schet01', 42)], rules: [rule(on.tap('knopka'), [act.recordVar('Очки в игре', 'schet01')])] }, [ev.tap('knopka')], (o) => expect(o.of('record')).toEqual([{ type: 'record', label: 'Очки в игре', value: 42 }])),
  sc('AC-14: записать текст', { blocks: [K], rules: [rule(on.tap('knopka'), [act.recordText('Выбор', 'Санки')])] }, [ev.tap('knopka')], (o) => expect(o.of('record')).toEqual([{ type: 'record', label: 'Выбор', value: 'Санки' }])),
  sc('AC-14: удалённая переменная — предупреждение', { blocks: [K], rules: [rule(on.tap('knopka'), [act.recordVar('Очки', 'udalena1')])] }, [ev.tap('knopka')], (o) => expect(o.warnings).toEqual(['Записать в ответы: переменная удалена'])),

  // ── AC-15 завершить ─────────────────────────────────────────────────────────
  sc('AC-15: завершить с результатом', { blocks: [K], rules: [rule(on.tap('knopka'), [act.finish('победа')])] }, [ev.tap('knopka')], (o) => expect(o.of('finish')).toEqual([{ type: 'finish', resultKey: 'победа' }])),
  sc('AC-15: завершить по таймеру; дальше ничего не выполняется', { vars: [S], rules: [rule(on.after(30), [act.finish(), act.add('schet01')])] }, [tick(30_000), tick(1000)], (o) => {
    expect(o.of('finish')).toEqual([{ type: 'finish' }]);
    expect(score(o)).toBe(0);
  }),

  // ── AC-16 открыть ссылку (TS-07) ────────────────────────────────────────────
  sc('AC-16: по нажатию — открывается', { blocks: [K], rules: [rule(on.tap('knopka'), [act.link('https://blokum.ru/')])] }, [ev.tap('knopka')], (o) => expect(o.of('openLink')).toEqual([{ type: 'openLink', url: 'https://blokum.ru/' }])),
  sc('AC-16: после паузы жест уже закончился — не открывается', { blocks: [K], rules: [rule(on.tap('knopka'), [act.wait(100), act.link()])] }, [ev.tap('knopka'), tick(100)], (o) => {
    expect(o.of('openLink')).toEqual([]);
    expect(o.warnings).toEqual(['Ссылку можно открыть только сразу по действию участника']);
  }),
  sc('AC-16: опасная схема ссылки отклоняется', { blocks: [K], rules: [rule(on.tap('knopka'), [act.link('javascript:alert(1)')])] }, [ev.tap('knopka')], (o) => {
    expect(o.of('openLink')).toEqual([]);
    expect(o.warnings).toEqual(['Недопустимая ссылка: можно только https://, http://, mailto: и tel:']);
  }),

  // ── AC-17 скопировать текст ─────────────────────────────────────────────────
  sc('AC-17: по нажатию — копируется', { blocks: [K], rules: [rule(on.tap('knopka'), [act.copy('ЁЛКА2026')])] }, [ev.tap('knopka')], (o) => expect(o.of('copyText')).toEqual([{ type: 'copyText', text: 'ЁЛКА2026' }])),
  sc('AC-17: по таймеру — не копируется', { rules: [rule(on.after(1), [act.copy()])] }, [tick(1000)], (o) => {
    expect(o.of('copyText')).toEqual([]);
    expect(o.warnings).toEqual(['Скопировать текст можно только сразу по действию участника']);
  }),

  // ── AC-18 взаимодействие ────────────────────────────────────────────────────
  sc('AC-18: запретить нажатия', { blocks: [K, K2], vars: [S], rules: [rule(on.tap('knopka'), [act.interaction('knopka2', false)]), rule(on.tap('knopka2'), [act.add('schet01')])] }, [ev.tap('knopka'), ev.tap('knopka2')], (o) => {
    expect(score(o)).toBe(0);
    expect(o.view('knopka2')?.interactive).toBe(false);
  }),
  sc(
    'AC-18: снова разрешить',
    { blocks: [K, K2], vars: [S], rules: [rule(on.tap('knopka'), [act.interaction('knopka2', false), act.wait(1000), act.interaction('knopka2', true)]), rule(on.tap('knopka2'), [act.add('schet01')])] },
    [ev.tap('knopka'), ev.tap('knopka2'), tick(1000), ev.tap('knopka2')],
    (o) => expect(score(o)).toBe(1),
  ),
  sc('AC-18: запрещённый блок не перетаскивается', { blocks: [gift, K], rules: [rule(on.tap('knopka'), [act.interaction('podarok', false)])] }, [ev.dragStart('podarok'), ev.tap('knopka'), ev.dragMove('podarok', 99, 99)], (o) =>
    expect(o.view('podarok')).toMatchObject({ dragging: false, x: 0 }),
  ),

  // ── AC-19 выбрать / сбросить ответ ──────────────────────────────────────────
  sc('AC-19: выбрать вариант', { blocks: [question(), K], rules: [rule(on.tap('knopka'), [act.select(2)])] }, [ev.tap('knopka')], (o) => {
    expect(o.of('answer')).toEqual([{ type: 'answer', questionBlockId: 'vopros', answer: { kind: 'choice', optionIds: ['vopros_otvet2'] } }]);
    expect(o.view('vopros_variant2')?.selected).toBe(true);
  }),
  sc('AC-19: сбросить ответ — срабатывает TR-12', { blocks: [question(), K], vars: [S], rules: [rule(on.tap('knopka'), [act.resetAnswer()]), rule(on.answer(), [act.add('schet01')])] }, [ev.answer(1), ev.tap('knopka')], (o) => {
    expect(o.of('answer')).toEqual([{ type: 'answer', questionBlockId: 'vopros', answer: null }]);
    expect(score(o)).toBe(2);
  }),
  sc('AC-19: в вопросе с несколькими ответами варианты накапливаются', { blocks: [question('vopros', true), K], rules: [rule(on.tap('knopka'), [act.select(1), act.select(2), act.select(1)])] }, [ev.tap('knopka')], (o) =>
    expect(o.of('answer').at(-1)?.answer).toEqual({ kind: 'choice', optionIds: ['vopros_otvet1', 'vopros_otvet2'] }),
  ),
  sc('AC-19: несуществующий вариант', { blocks: [question(), K], rules: [rule(on.tap('knopka'), [{ kind: 'answer', questionBlockId: 'vopros', command: 'select', optionId: 'drugoi01' }, act.select(1, 'knopka')])] }, [ev.tap('knopka')], (o) =>
    expect(o.warnings).toEqual(['Выбрать вариант: вариант не найден', 'Выбрать вариант: вопрос не найден на экране']),
  ),

  // ── AC-20 перемешать ────────────────────────────────────────────────────────
  sc('AC-20: перемешать карточки мемори — позиции те же, порядок другой', { blocks: cards, seed: 3, rules: [rule(on.show(), [act.shuffle('karta1', 'karta2', 'karta3', 'karta4')])] }, [], (o) => {
    const xs = ['karta1', 'karta2', 'karta3', 'karta4'].map((id) => o.view(id)!.x);
    expect([...xs].sort((a, c) => a - c)).toEqual([0, 60, 120, 180]);
    expect(xs).not.toEqual([0, 60, 120, 180]);
  }),
  sc('AC-20: одинаковый seed — одинаковое перемешивание', { blocks: cards, seed: 11, rules: [rule(on.show(), [act.shuffle('karta1', 'karta2', 'karta3', 'karta4')])] }, [], (o) => {
    const again = play({ blocks: cards, seed: 11, rules: [rule(on.show(), [act.shuffle('karta1', 'karta2', 'karta3', 'karta4')])] });
    expect(o.rt.views()).toEqual(again.rt.views());
  }),

  // ── SC-01 модель правила ────────────────────────────────────────────────────
  sc('SC-01: выключенное правило не срабатывает', { blocks: [K], vars: [S], rules: [rule(on.tap('knopka'), [act.add('schet01')], { enabled: false })] }, [ev.tap('knopka')], (o) => expect(score(o)).toBe(0)),
  sc('SC-01: «сработать один раз» — на всё прохождение', { blocks: [K], vars: [S], docRules: [rule(on.tap('knopka'), [act.add('schet01')], { once: true })] }, [ev.tap('knopka'), ev.tap('knopka'), { enter: 'ekran1' }, ev.tap('knopka')], (o) => expect(score(o)).toBe(1)),
  sc(
    'SC-01: приоритет — сначала важное правило',
    { blocks: [K], vars: [txt('poryadok')], rules: [rule(on.tap('knopka'), [act.op('poryadok', 'append', 'б')], { priority: 10 }), rule(on.tap('knopka'), [act.op('poryadok', 'append', 'а')], { priority: 90 }), rule(on.tap('knopka'), [act.op('poryadok', 'append', 'в')], { priority: 10 })] },
    [ev.tap('knopka')],
    (o) => expect(o.v('poryadok')).toBe('абв'),
  ),
  sc(
    'SC-01: правила блока, экрана и сборки работают вместе',
    { blocks: [b('shape', 'knopka', { rules: [rule(on.tap('knopka'), [act.add('schet01', 1)])] })], vars: [S], rules: [rule(on.tap('knopka'), [act.add('schet01', 10)])], docRules: [rule(on.tap('knopka'), [act.add('schet01', 100)])] },
    [ev.tap('knopka')],
    (o) => expect(score(o)).toBe(111),
  ),
  sc(
    'SC-01: правила блоков другого экрана не работают',
    { blocks: [K], vars: [S], screen2: { blocks: [b('shape', 'drugoi1', { rules: [rule(on.tap('knopka'), [act.add('schet01')])] })] } },
    [ev.tap('knopka')],
    (o) => expect(score(o)).toBe(0),
  ),

  // ── SC-04 защита от зацикливания ────────────────────────────────────────────
  sc('SC-04: больше 1000 действий за секунду — правило останавливается', { blocks: [K], vars: [S], rules: [rule(on.tap('knopka'), [act.repeat(5000, [act.add('schet01')])], { name: 'Много' })] }, [ev.tap('knopka'), ev.tap('knopka')], (o) => {
    expect(score(o)).toBe(999);
    expect(o.warnings).toEqual([`${LOOP_WARNING}: правило «Много» остановлено (больше 1000 действий за секунду)`]);
  }),
  sc(
    'SC-04: правила вызывают друг друга по кругу — остановка на 20 вложенных вызовах',
    { blocks: [K], vars: [num('iks001'), num('igrek1')], rules: [rule(on.tap('knopka'), [act.add('iks001')]), rule(on.change('iks001'), [act.add('igrek1')], { name: 'Икс' }), rule(on.change('igrek1'), [act.add('iks001')], { name: 'Игрек' })] },
    [ev.tap('knopka')],
    (o) => {
      expect(o.warnings).toHaveLength(1);
      expect(o.warnings[0]).toMatch(/^Похоже на бесконечный цикл: правило «(Икс|Игрек)» остановлено \(правила вызывают друг друга больше 20 раз подряд\)$/);
      expect((o.v('iks001') as number) + (o.v('igrek1') as number)).toBe(21);
    },
  ),
  sc(
    'SC-04: остановленное правило снова работает на следующем показе экрана',
    { blocks: [K], vars: [S], rules: [rule(on.tap('knopka'), [act.repeat(2000, [act.add('schet01')])])] },
    [ev.tap('knopka'), tick(1000), { enter: 'ekran1' }, (rt) => expect(rt.variables.schet01).toBe(999), ev.tap('knopka')],
    (o) => expect(score(o)).toBe(1998),
  ),
  sc('SC-04: бюджет действий обновляется каждую секунду', { vars: [S], rules: [rule(on.every(1), [act.repeat(600, [act.add('schet01')])])] }, [tick(5000)], (o) => {
    expect(score(o)).toBe(3000);
    expect(o.warnings).toEqual([]);
  }),

  // ── VR-01…VR-04 переменные ──────────────────────────────────────────────────
  sc('VR-01: четыре типа с начальными значениями', { vars: [num('chislo', 3), txt('tekst1', 'а'), bool('danet1', true), list('spisok', [1, 'два'])] }, [], (o) => expect(o.rt.variables).toEqual({ chislo: 3, tekst1: 'а', danet1: true, spisok: [1, 'два'] })),
  sc('VR-01: значения живут всё прохождение, а не один экран', { vars: [S], docRules: [rule(on.show(), [act.add('schet01')])] }, [{ enter: 'ekran2' }, { enter: 'ekran1' }, { enter: 'ekran2' }], (o) => expect(score(o)).toBe(4)),
  sc(
    'VR-02: правила ссылаются на переменную по id — переименование не ломает',
    { blocks: [K], vars: [{ id: 'schet01', name: 'новое_имя', type: 'number', initial: 0, saveToAnswers: false }], rules: [rule(on.tap('knopka'), [act.add('schet01')])] },
    [ev.tap('knopka')],
    (o) => expect(score(o)).toBe(1),
  ),
  sc('VR-03: системные значения недоступны для записи — их нет среди переменных', { vars: [S] }, [], (o) => expect(Object.keys(o.rt.variables)).toEqual(['schet01'])),
  sc('VR-04: «сохранять в ответы» — значение в конце прохождения', { blocks: [K], vars: [num('schet01', 0, true), num('skryto', 5)], rules: [rule(on.tap('knopka'), [act.add('schet01', 7)])] }, [ev.tap('knopka')], (o) =>
    expect(variablesToRecord(buildDoc({ vars: [num('schet01', 0, true), num('skryto', 5)] }), o.rt.variables)).toEqual([{ label: 'schet01', value: 7 }]),
  ),
  sc('VR-01: блок «Значение» обновляется при изменении переменной', { blocks: [K, b('value', 'znachen', { props: { variableId: 'schet01' } })], vars: [S], rules: [rule(on.tap('knopka'), [act.add('schet01')])] }, [ev.tap('knopka')], (o) => {
    expect(o.steps[1]?.changed).toContain('znachen');
    expect(o.steps[1]?.variables).toEqual({ schet01: 1 });
  }),

  // ── TS-07 ссылки только по жесту ────────────────────────────────────────────
  sc('TS-07: при показе экрана ссылка не открывается', { rules: [rule(on.show(), [act.link()])] }, [], (o) => {
    expect(o.of('openLink')).toEqual([]);
    expect(o.warnings).toEqual(['Ссылку можно открыть только сразу по действию участника']);
  }),
  sc('TS-07: по таймеру ссылка не открывается', { rules: [rule(on.after(1), [act.link()]), rule(on.every(2), [act.if(is.chance(100), [act.link()])])] }, [tick(2000)], (o) => expect(o.of('openLink')).toEqual([])),
  sc(
    'TS-07: правило, вызванное изменением переменной после нажатия, — не жест',
    { blocks: [K], vars: [S], rules: [rule(on.tap('knopka'), [act.add('schet01')]), rule(on.change('schet01'), [act.link(), act.copy()])] },
    [ev.tap('knopka')],
    (o) => expect([o.of('openLink'), o.of('copyText')]).toEqual([[], []]),
  ),
  sc('TS-07: столкновение и окончание видео — не жесты', { blocks: [video, b('shape', 'myach01'), b('shape', 'vorota')], rules: [rule(on.mediaEnd('rolik1'), [act.link()]), rule(on.collide('myach01', 'vorota'), [act.link()])] }, [ev.mediaEnd('rolik1'), tick(16)], (o) => {
    expect(o.of('openLink')).toEqual([]);
    expect(o.warnings).toHaveLength(2);
  }),
  sc('TS-07: свайп, перетаскивание и клавиша — жесты', { blocks: [gift], rules: [rule(on.swipe('up'), [act.link()]), rule(on.drag('podarok'), [act.copy()]), rule(on.key('Enter'), [act.link('mailto:ded@moroz.ru')])] }, [ev.swipe('up'), ev.dragStart('podarok'), ev.key('Enter')], (o) =>
    expect(o.effects.map((e) => e.type)).toEqual(['openLink', 'copyText', 'openLink']),
  ),

  // ── Последовательности ──────────────────────────────────────────────────────
  sc(
    'AC-11: светофор — последовательность с паузами в цикле',
    { blocks: [b('shape', 'svetof1')], vars: [list('cveta01')], rules: [rule(on.show(), [act.repeat(2, [act.op('cveta01', 'append', 'к'), act.wait(1000), act.op('cveta01', 'append', 'ж'), act.wait(500), act.op('cveta01', 'append', 'з'), act.wait(1000)])])] },
    [tick(1000), (rt) => expect(rt.variables.cveta01).toEqual(['к', 'ж']), tick(5000)],
    (o) => expect(o.v('cveta01')).toEqual(['к', 'ж', 'з', 'к', 'ж', 'з']),
  ),
  sc(
    'AC-11: одно правило запущено дважды — две независимые последовательности',
    { blocks: [K], vars: [S], rules: [rule(on.tap('knopka'), [act.wait(1000), act.add('schet01')])] },
    [ev.tap('knopka'), tick(500), ev.tap('knopka'), tick(500), (rt) => expect(rt.variables.schet01).toBe(1), tick(500)],
    (o) => expect(score(o)).toBe(2),
  ),
  sc(
    'TR-10: «Поймай снежинку» — генерация, падение и счёт за 3 секунды',
    {
      blocks: [hiddenStar, b('shape', 'lovushka', { frame: { x: 0, y: 600, w: 390, h: 40 } })],
      vars: [S],
      rules: [rule(on.every(0.5), [act.spawn('zvezda', { kind: 'randomIn', area: { x: 0, y: 0, w: 390, h: 10 } })]), rule(on.collideCopies('zvezda', 'lovushka'), [act.add('schet01'), act.destroy('self')])],
    },
    Array.from({ length: 120 }, (_, i) => (i % 2 === 0 ? (rt: Runtime) => rt.views().filter((v) => v.copy).forEach((v) => rt.setMotion(v.id, { vx: 0, vy: 800 })) : tick(50))),
    (o) => {
      expect(score(o)).toBeGreaterThanOrEqual(4);
      expect(o.rt.views().filter((v) => v.copy).length).toBeLessThanOrEqual(2);
    },
  ),
];

describe('движок сценариев: табличные сценарии', () => {
  it('сценариев не меньше 150', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(150);
  });

  it.each(scenarios.map((s) => [s.name, s] as const))('%s', (_name, s) => {
    s.check(play(s.world, s.steps));
  });

  it('каждый триггер, условие и действие — минимум в двух сценариях', () => {
    const count = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`).filter((id) => scenarios.filter((s) => s.name.startsWith(`${id}:`)).length < 2);
    expect([...count('TR', 16), ...count('CN', 6), ...count('AC', 20)]).toEqual([]);
  });
});
