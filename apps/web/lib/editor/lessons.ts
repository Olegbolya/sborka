import type { ProjectDocument } from '@blokum/schema';

/*
 * P10.5 · интерактивные уроки внутри редактора. Урок — данные: список шагов; шаг сам видит по документу, что его сделали
 * (`done`), либо подтверждается кнопкой «Готово» (`manual`). Уроки не требуют ни медиатеки, ни готовых тем, ни шаблонов.
 */
export interface LessonStep {
  readonly title: string;
  readonly text: string;
  /** Шаг выполнен, если документ уже такой. Без этого поля шаг подтверждает сам автор. */
  readonly done?: (doc: ProjectDocument) => boolean;
  /** CSS-селектор элементов редактора, которые подсвечиваются на этом шаге. */
  readonly target?: string;
}
export interface Lesson {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly LessonStep[];
}

type Node = Record<string, unknown>;
/** Все объекты внутри значения (документ — это дерево: экраны → блоки → правила → действия). */
function* nodes(value: unknown): Generator<Node> {
  if (Array.isArray(value)) for (const v of value) yield* nodes(v);
  else if (value && typeof value === 'object') {
    yield value as Node;
    for (const v of Object.values(value)) yield* nodes(v);
  }
}
const find = (doc: ProjectDocument, pred: (n: Node) => boolean): Node[] => [...nodes(doc.screens), ...nodes(doc.rules)].filter(pred);
const count = (doc: ProjectDocument, pred: (n: Node) => boolean): number => find(doc, pred).length;
const blocks = (doc: ProjectDocument, type: string): number => count(doc, (n) => n.type === type && typeof n.frame === 'object');
const kindIs = (kind: string) => (n: Node) => n.kind === kind;
const hasKinds = (doc: ProjectDocument, kind: string, min = 1) => count(doc, kindIs(kind)) >= min;
const rulesWhen = (doc: ProjectDocument, kind: string, extra: (r: Node) => boolean = () => true): number =>
  count(doc, (n) => typeof n.when === 'object' && n.when !== null && (n.when as Node).kind === kind && extra(n));
const isCopies = (key: string) => (r: Node) => ((r.when as Node)[key] as Node | undefined)?.kind === 'copiesOf';
const preview = { title: 'Проверьте в предпросмотре', text: 'Нажмите «Предпросмотр» вверху и пройдите игру, как участник. Когда проверили, вернитесь сюда и нажмите «Готово».', target: '[data-lesson="preview"]' } as const;
const variables = (min: number): LessonStep => ({
  title: 'Заведите переменные',
  text: 'Нажмите «Сценарии» → «Переменные» и добавьте две переменные, например «Очки» и «Разложено». Переменная помнит число — очки, пойманные звёзды.',
  target: '[data-lesson="scenarios"]',
  done: (d) => d.variables.length >= min,
});

export const LESSONS: readonly Lesson[] = [
  {
    id: 'rg-01',
    title: 'Убегающая кнопка «Нет»',
    summary: 'Кнопка, которая убегает от пальца, а на третий раз сдаётся.',
    steps: [
      { title: 'Вопрос и две кнопки', text: 'На вкладке «Добавить» поставьте текст с вопросом и две кнопки: «Да» и «Нет».', target: '[data-add-type="button"]', done: (d) => blocks(d, 'text') >= 1 && blocks(d, 'button') >= 2 },
      { title: 'Поведение «Убегает»', text: 'Выберите кнопку «Нет», откройте вкладку «Сценарии» и добавьте поведение «Убегает». Поставьте, сколько раз она убегает.', target: 'select[aria-label="Добавить поведение"]', done: (d) => hasKinds(d, 'flee') },
      { title: 'Первое нажатие: сомнение', text: 'Добавьте правило «Нажали». Включите «Проверять условие» и выберите «Сколько правил сработало — меньше 2». Действие — «Изменить свойство»: текст «Точно нет?».', target: 'select[aria-label="Добавить правило: когда"]', done: (d) => rulesWhen(d, 'tap', (r) => (r.if as Node | undefined)?.kind === 'ruleCount') >= 1 },
      { title: 'Второе нажатие: сдаётся', text: 'Добавьте второе правило «Нажали» с условием «не меньше 2»: текст «Да!», эффект, пауза и «Перейти».', done: (d) => rulesWhen(d, 'tap', (r) => (r.if as Node | undefined)?.kind === 'ruleCount') >= 2 && hasKinds(d, 'goTo') },
      { title: 'Второй экран', text: 'На вкладке «Экраны» добавьте экран с благодарностью и кнопкой «Закончить».', done: (d) => d.screens.length >= 2 },
      preview,
    ],
  },
  {
    id: 'rg-06',
    title: 'Поймай объект',
    summary: 'С неба падают звёзды: пойманные считаются, время ограничено.',
    steps: [
      variables(2),
      { title: 'Звезда-образец', text: 'Добавьте фигуру с текстом «⭐». В «Оформление» включите «Скрыт, пока правило его не покажет», в «Сценарии» добавьте поведение «Движется».', target: 'select[aria-label="Добавить поведение"]', done: (d) => d.screens.some((s) => s.blocks.some((b) => b.initiallyHidden && b.behaviors.some((x) => x.kind === 'move'))) },
      { title: 'Генератор копий', text: 'Добавьте маленькую фигуру и дайте ей поведение «Выпускает копии». В поле «Чьи копии» выберите звезду.', target: 'select[aria-label="Добавить поведение"]', done: (d) => hasKinds(d, 'spawner') },
      { title: 'Земля и время', text: 'Добавьте блок «Зона» у нижнего края (это земля) и блок «Таймер» на 8 секунд. Ещё нужен блок «Значение» для счёта.', target: '[data-add-type="timer"]', done: (d) => blocks(d, 'zone') >= 1 && blocks(d, 'timer') >= 1 && blocks(d, 'value') >= 1 },
      { title: 'Поймали', text: 'В «Сценарии» → «Правила экрана» добавьте «Нажали» → «Любая копия блока» → звезда. Действия: «Изменить переменную» (+1) и «Удалить блок» (тот, у которого сработало правило).', target: '[data-lesson="scenarios"]', done: (d) => rulesWhen(d, 'tap', isCopies('source')) >= 1 },
      { title: 'Упала', text: 'Правило «Столкнулись»: копия звезды и земля. Прибавьте второй переменной единицу и удалите копию.', done: (d) => rulesWhen(d, 'collide', isCopies('source')) >= 1 },
      { title: 'Конец игры', text: 'Правило «Прошло время» → «когда закончился таймер»: «Записать в ответы» и «Перейти».', done: (d) => rulesWhen(d, 'timer', (r) => (r.when as Node).mode === 'timerEnd') >= 1 },
      preview,
    ],
  },
  {
    id: 'rg-07',
    title: 'Перетащи на место',
    summary: 'Фрукты нужно разложить по подписям, за каждый — очки.',
    steps: [
      variables(2),
      { title: 'Три фрукта', text: 'Добавьте три фигуры с эмодзи (🍎 🍌 🍇) и каждой дайте поведение «Перетаскивается».', target: 'select[aria-label="Добавить поведение"]', done: (d) => hasKinds(d, 'drag', 3) },
      { title: 'Зоны и подписи', text: 'Поставьте три блока «Зона» и под каждым — текст-подпись. В поведении каждого фрукта добавьте его зону в «Прилипает к зонам».', target: '[data-add-type="zone"]', done: (d) => blocks(d, 'zone') >= 3 && count(d, (n) => n.kind === 'drag' && Array.isArray(n.snapToZones) && n.snapToZones.length > 0) >= 3 },
      { title: 'Правила «Положили на место»', text: 'В «Сценарии» → «Правила экрана» добавьте по правилу на фрукт: «Положили на место», действия «Изменить переменную» (+10 очков, +1 разложено) и «Эффект».', target: '[data-lesson="scenarios"]', done: (d) => rulesWhen(d, 'drop') >= 3 },
      { title: 'Когда всё разложено', text: 'В «Правилах сборки» добавьте «Изменилась переменная» с условием «Разложено не меньше 3»: пауза и «Перейти».', done: (d) => d.rules.some((r) => r.when.kind === 'variableChange' && r.if !== undefined) },
      { title: 'Итоговый экран', text: 'Добавьте второй экран с итогом и кнопкой «Закончить».', done: (d) => d.screens.length >= 2 },
      preview,
    ],
  },
  {
    id: 'theme',
    title: 'Как сделать свою тему',
    summary: 'Задайте цвета и шрифты один раз — и применяйте к любым сборкам.',
    steps: [
      { title: 'Откройте редактор тем', text: 'Нажмите «Тема» → «Редактор тем» (раздел «Мои темы» в кабинете). Создайте тему, задайте цвета, шрифты, скругления и сохраните. Библиотека готовых тем для этого не нужна.', target: '[data-lesson="theme"]' },
      { title: 'Примените тему', text: 'Вернитесь в сборку, нажмите «Тема» и «Применить» у своей темы. Либо подберите цвета вручную и нажмите «Сохранить как тему».', target: '[data-lesson="theme"]', done: (d) => d.theme.themeId !== undefined },
      { title: 'Ваши правки сохраняются', text: 'Блоки, которые вы настроили вручную, при смене темы не меняются; «Сбросить к теме» в «Оформлении» возвращает их к теме. Нажмите «Готово».' },
    ],
  },
  {
    id: 'meme',
    title: 'Как вставить мем-переход',
    summary: 'Между экранами на секунду показывается ваша картинка или GIF.',
    steps: [
      { title: 'Два экрана', text: 'На вкладке «Экраны» должно быть минимум два экрана.', done: (d) => d.screens.length >= 2 },
      { title: 'Кнопка с переходом', text: 'Поставьте кнопку и дайте ей правило «Нажали» с действием «Перейти».', target: '[data-add-type="button"]', done: (d) => hasKinds(d, 'goTo') },
      { title: 'Вид перехода — «Вставка с мемом»', text: 'В действии «Перейти» откройте поле «Переход» и выберите «Вставка с мемом».', done: (d) => count(d, (n) => n.kind === 'goTo' && typeof n.transition === 'object' && n.transition !== null && (n.transition as Node).kind === 'media') >= 1 },
      { title: 'Своя картинка', text: 'Выберите картинку или GIF в «Вставка». Если медиатека пуста — загрузите свою прямо из этого поля: готовые мемы не нужны.', done: (d) => count(d, (n) => n.kind === 'goTo' && typeof n.transition === 'object' && n.transition !== null && (n.transition as Node).kind === 'media' && ((((n.transition as Node).overlay as Node | undefined)?.media as Node | undefined)?.id ?? 'media_unset') !== 'media_unset') >= 1 },
      preview,
    ],
  },
];

/** Номера выполненных шагов: те, что подтверждает документ, и те, что автор отметил сам. */
export function completed(lesson: Lesson, doc: ProjectDocument, manual: ReadonlySet<number>): boolean[] {
  return lesson.steps.map((s, i) => (s.done ? s.done(doc) : manual.has(i)));
}
/** Первый невыполненный шаг; равен числу шагов, если урок пройден. */
export function currentStep(flags: readonly boolean[]): number {
  const i = flags.indexOf(false);
  return i === -1 ? flags.length : i;
}
