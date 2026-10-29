import { type Action, type Condition, type ProjectDocument, type Trigger } from '@blokum/schema';
import { PROPERTY_TITLES, allBlocks } from './scenario-specs';

/** P3.8 · SC-02 · a rule told in a sentence of plain Russian: «Когда нажали на «Кнопка» → прибавить 1 к «Очки»». */
export interface Names {
  blocks: Map<string, string>;
  variables: Map<string, string>;
  screens: Map<string, string>;
}

export function namesOf(doc: ProjectDocument): Names {
  return {
    blocks: new Map(allBlocks(doc).map(({ block }) => [block.id, block.name])),
    variables: new Map(doc.variables.map((v) => [v.id, v.name])),
    screens: new Map(doc.screens.map((s) => [s.id, s.name])),
  };
}

const q = (s: string) => `«${s}»`;
const block = (n: Names, id: string) => q(n.blocks.get(id) ?? 'блок удалён');
const variable = (n: Names, id: string) => q(n.variables.get(id) ?? 'переменная удалена');

function source(n: Names, s: { kind: string; blockId?: string; groupId?: string }): string {
  if (s.kind === 'block') return block(n, s.blockId!);
  if (s.kind === 'copiesOf') return `копии ${block(n, s.blockId!)}`;
  return 'группу блоков';
}
function target(n: Names, t: { kind: string; blockId?: string }): string {
  if (t.kind === 'self') return 'этот блок';
  if (t.kind === 'copiesOf') return `копии ${block(n, t.blockId!)}`;
  return block(n, t.blockId!);
}

const MOTIONS: Record<string, string> = { shake: 'встряхнули телефон', tiltLeft: 'наклонили телефон влево', tiltRight: 'наклонили телефон вправо', tiltForward: 'наклонили телефон от себя', tiltBack: 'наклонили телефон к себе' };
const DIRECTIONS: Record<string, string> = { left: 'влево', right: 'вправо', up: 'вверх', down: 'вниз' };

export function describeTrigger(t: Trigger, n: Names): string {
  switch (t.kind) {
    case 'tap':
      return `нажали на ${source(n, t.source)}`;
    case 'doubleTap':
      return `нажали дважды на ${source(n, t.source)}`;
    case 'longPress':
      return `держат нажатым ${source(n, t.source)}`;
    case 'hover':
      return t.phase === 'enter' ? `навели на ${source(n, t.source)}` : `убрали курсор с ${source(n, t.source)}`;
    case 'drag':
      return t.phase === 'start' ? `начали тащить ${source(n, t.source)}` : `отпустили ${source(n, t.source)}`;
    case 'drop':
      return `${source(n, t.source)} положили на ${source(n, t.target)}`;
    case 'collide':
      return t.phase === 'start' ? `${source(n, t.source)} коснулся ${source(n, t.target)}` : `${source(n, t.source)} разошёлся с ${source(n, t.target)}`;
    case 'swipe':
      return `смахнули ${DIRECTIONS[t.direction]!}${t.on === 'screen' ? '' : ` по ${source(n, t.on)}`}`;
    case 'screen':
      return t.phase === 'show' ? 'экран открылся' : 'экран закрывается';
    case 'timer':
      return t.mode === 'after' ? `прошло ${t.seconds ?? 0} с` : t.mode === 'every' ? `каждые ${t.seconds ?? 0} с` : `закончился таймер ${t.timerBlockId ? block(n, t.timerBlockId) : ''}`.trim();
    case 'variableChange':
      return `изменилась переменная ${variable(n, t.variableId)}`;
    case 'answer':
      return `ответили на ${block(n, t.questionBlockId)}`;
    case 'mediaEnd':
      return `закончилось ${source(n, t.source)}`;
    case 'scratched':
      return `стёрли ${t.percent}% у ${source(n, t.source)}`;
    case 'deviceMotion':
      return MOTIONS[t.motion]!;
    case 'key':
      return `нажали клавишу ${q(t.key)}`;
  }
}

const OPS: Record<string, string> = { eq: '=', ne: '≠', gt: '>', lt: '<', gte: '≥', lte: '≤', contains: 'содержит', empty: 'пусто' };

export function describeCondition(c: Condition, n: Names): string {
  switch (c.kind) {
    case 'variable':
      return `${variable(n, c.variableId)} ${OPS[c.op]!}${c.op === 'empty' || c.value === undefined ? '' : ` ${String(c.value)}`}`;
    case 'answer':
      return `ответ на ${block(n, c.questionBlockId)}: ${c.op === 'correct' ? 'верный' : c.op === 'wrong' ? 'неверный' : c.op === 'empty' ? 'пусто' : c.op === 'selected' ? 'выбран вариант' : c.op === 'notSelected' ? 'вариант не выбран' : `${c.op === 'eq' ? '=' : c.op === 'contains' ? 'содержит' : c.op === 'scoreGte' ? 'баллов ≥' : 'баллов ≤'} ${String(c.value ?? '')}`}`;
    case 'blockState':
      return `${block(n, c.blockId)}: ${{ visible: 'виден', hidden: 'скрыт', selected: 'выбран', onZone: 'на зоне', dragging: 'тащат', copiesCount: 'число копий' }[c.state]}${c.op ? ` ${OPS[c.op]!} ${c.value ?? 0}` : ''}`;
    case 'ruleCount':
      return `правило сработало ${OPS[c.op]!} ${c.value} раз`;
    case 'chance':
      return `случайно, ${c.percent}%`;
    case 'group': {
      const joiner = c.op === 'and' ? ' и ' : c.op === 'or' ? ' или ' : ' и не ';
      return `${c.op === 'not' ? 'не ' : ''}(${c.items.map((i) => describeCondition(i, n)).join(joiner)})`;
    }
  }
}

const VAR_OPS: Record<string, string> = { set: 'записать', add: 'прибавить', sub: 'вычесть', mul: 'умножить', div: 'разделить', random: 'случайное число', pickRandom: 'случайный элемент', append: 'добавить в список', remove: 'убрать из списка', toggle: 'переключить' };
const EFFECTS: Record<string, string> = { confetti: 'конфетти', burst: 'взрыв', shake: 'тряска', flash: 'вспышка', vibrate: 'вибрация' };

export function describeAction(a: Action, n: Names): string {
  switch (a.kind) {
    case 'visibility':
      return `${{ show: 'показать', hide: 'скрыть', toggle: 'переключить' }[a.mode]} ${a.targets.map((t) => target(n, t)).join(', ')}`;
    case 'setProperty':
      return `изменить «${PROPERTY_TITLES[a.property].toLowerCase()}» у ${target(n, a.target)}`;
    case 'animateProperty':
      return `плавно изменить «${a.property}» у ${target(n, a.target)}`;
    case 'move':
      return `переместить ${target(n, a.target)}`;
    case 'setVariable':
      return `${VAR_OPS[a.op]!} ${variable(n, a.variableId)}${a.value === undefined ? '' : ` (${String(a.value)})`}`;
    case 'goTo':
      return a.to === 'next' ? 'перейти дальше' : a.to === 'back' ? 'вернуться назад' : a.to === 'branch' ? 'перейти по ветвлению' : `перейти на экран ${q(n.screens.get(a.screenId ?? '') ?? 'экран удалён')}`;
    case 'media':
      return `${{ play: 'включить', pause: 'поставить на паузу', stop: 'остановить', restart: 'запустить сначала' }[a.command]} ${target(n, a.target)}`;
    case 'effect':
      return `эффект «${EFFECTS[a.effect]!}»`;
    case 'mediaOverlay':
      return 'вставка на весь экран';
    case 'spawn':
      return `создать копию ${block(n, a.prototypeId)}`;
    case 'destroy':
      return `удалить ${target(n, a.target)}`;
    case 'wait':
      return `подождать ${a.ms} мс`;
    case 'timer':
      return `${{ start: 'запустить', stop: 'остановить', reset: 'сбросить' }[a.command]} таймер ${block(n, a.timerBlockId)}`;
    case 'record':
      return `записать в ответы «${a.label}»`;
    case 'finish':
      return 'завершить прохождение';
    case 'openLink':
      return `открыть ссылку ${a.url}`;
    case 'copyText':
      return 'скопировать текст';
    case 'interaction':
      return `${a.enabled ? 'включить' : 'выключить'} нажатия на ${target(n, a.target)}`;
    case 'answer':
      return `${a.command === 'select' ? 'выбрать вариант' : 'очистить ответ'} в ${block(n, a.questionBlockId)}`;
    case 'shuffle':
      return `перемешать ${a.blockIds.length} блоков`;
    case 'playSound':
      return 'сыграть звук';
    case 'if':
      return `если ${describeCondition(a.if, n)}`;
    case 'repeat':
      return a.times !== undefined ? `повторить ${a.times} раз` : `повторять, пока ${a.while ? describeCondition(a.while, n) : ''}`;
  }
}
