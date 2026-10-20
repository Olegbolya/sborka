import { type Block, walkBlocks } from './blocks.js';
import { type BranchTarget, type ProjectDocument, type Screen } from './document.js';
import { type Action, type Condition, GESTURE_TRIGGERS, type Rule, type Source, type Target, type Trigger } from './scenario.js';
import { plainText } from './text.js';

/**
 * Pre-publish validation of logic (L-08) and scenarios (SC-07, TS-07). Errors block publishing,
 * warnings do not (SR-01). Messages are in Russian and point to the place in the document.
 */
export interface ValidationIssue {
  code:
    | 'UNREACHABLE_SCREEN'
    | 'NO_EXIT'
    | 'ENDLESS_LOOP'
    | 'MISSING_BLOCK'
    | 'MISSING_VARIABLE'
    | 'MISSING_SCREEN'
    | 'MISSING_OPTION'
    | 'BLOCK_ON_OTHER_SCREEN'
    | 'EMPTY_OPTION'
    | 'OPTION_NOT_CHILD'
    | 'LINK_WITHOUT_GESTURE';
  severity: 'error' | 'warning';
  path: Array<string | number>;
  message: string;
}

type Path = Array<string | number>;

function* walkActions(actions: readonly Action[], path: Path): Generator<[Action, Path]> {
  for (const [i, a] of actions.entries()) {
    const p = [...path, i];
    yield [a, p];
    if (a.kind === 'if') {
      yield* walkActions(a.then, [...p, 'then']);
      yield* walkActions(a.else, [...p, 'else']);
    }
    if (a.kind === 'repeat') yield* walkActions(a.do, [...p, 'do']);
  }
}

function* walkConditions(c: Condition | undefined): Generator<Condition> {
  if (!c) return;
  yield c;
  if (c.kind === 'group') for (const item of c.items) yield* walkConditions(item);
}

function* actionConditions(a: Action): Generator<Condition> {
  if (a.kind === 'if') yield* walkConditions(a.if);
  if (a.kind === 'repeat') yield* walkConditions(a.while);
}

interface RuleSite {
  rule: Rule;
  path: Path;
  /** Screen the rule lives on; undefined for document-level rules. */
  screen?: Screen;
}

function collectRules(doc: ProjectDocument): RuleSite[] {
  const sites: RuleSite[] = doc.rules.map((rule, i) => ({ rule, path: ['rules', i] }));
  doc.screens.forEach((screen, si) => {
    screen.rules.forEach((rule, i) => sites.push({ rule, screen, path: ['screens', si, 'rules', i] }));
    for (const b of walkBlocks(screen.blocks)) {
      b.rules.forEach((rule, i) => sites.push({ rule, screen, path: ['screens', si, 'block', b.id, 'rules', i] }));
    }
  });
  return sites;
}

const sourceBlock = (s: Source): string | undefined => (s.kind === 'group' ? undefined : s.blockId);
const targetBlock = (t: Target): string | undefined => (t.kind === 'self' ? undefined : t.blockId);

/** Block ids a trigger refers to. */
function triggerBlocks(t: Trigger): string[] {
  const ids: Array<string | undefined> = [];
  if ('source' in t) ids.push(sourceBlock(t.source));
  if ('target' in t) ids.push(sourceBlock(t.target));
  if (t.kind === 'swipe' && t.on !== 'screen') ids.push(sourceBlock(t.on));
  if (t.kind === 'timer') ids.push(t.timerBlockId);
  if (t.kind === 'answer') ids.push(t.questionBlockId);
  return ids.filter((x): x is string => Boolean(x));
}

/**
 * Ids a condition refers to. `blocks` are live blocks (must be on the same screen as the rule);
 * `questions` are answers, which stay available after their screen (L-02 branches on earlier answers).
 */
function conditionRefs(c: Condition): { blocks: string[]; questions: string[]; variables: string[]; options: string[] } {
  const none = { blocks: [], questions: [], variables: [], options: [] };
  switch (c.kind) {
    case 'variable':
      return { ...none, variables: [c.variableId] };
    case 'answer':
      return { ...none, questions: [c.questionBlockId], options: c.optionId ? [c.optionId] : [] };
    case 'blockState':
      return { ...none, blocks: [c.blockId, ...(c.zoneId ? [c.zoneId] : [])] };
    default:
      return none;
  }
}

function actionRefs(a: Action): { blocks: string[]; variables: string[]; screens: string[]; options: string[] } {
  const r = { blocks: [] as string[], variables: [] as string[], screens: [] as string[], options: [] as string[] };
  const t = (x: Target | undefined) => {
    const id = x ? targetBlock(x) : undefined;
    if (id) r.blocks.push(id);
  };
  switch (a.kind) {
    case 'visibility':
      a.targets.forEach(t);
      break;
    case 'setProperty':
    case 'animateProperty':
    case 'media':
    case 'destroy':
    case 'interaction':
      t(a.target);
      break;
    case 'move':
      t(a.target);
      if (a.to.kind === 'block') r.blocks.push(a.to.blockId);
      break;
    case 'effect':
      t(a.at);
      break;
    case 'setVariable':
      r.variables.push(a.variableId);
      break;
    case 'goTo':
      if (a.to === 'screen' && a.screenId) r.screens.push(a.screenId);
      break;
    case 'spawn':
      r.blocks.push(a.prototypeId);
      if (a.at.kind === 'block') r.blocks.push(a.at.blockId);
      break;
    case 'timer':
      r.blocks.push(a.timerBlockId);
      break;
    case 'record':
      if ('variableId' in a.value) r.variables.push(a.value.variableId);
      break;
    case 'answer':
      r.blocks.push(a.questionBlockId);
      if (a.optionId) r.options.push(a.optionId);
      break;
    case 'shuffle':
      r.blocks.push(...a.blockIds);
      break;
    default:
      break;
  }
  return r;
}

/** Screen-to-screen edges used for reachability and loop checks. `finish` ends the pass. */
function screenEdges(doc: ProjectDocument): { edges: Map<string, Set<string>>; finishing: Set<string>; exits: Set<string> } {
  const index = new Map(doc.screens.map((s, i) => [s.id, i]));
  const edges = new Map<string, Set<string>>(doc.screens.map((s) => [s.id, new Set<string>()]));
  const finishing = new Set<string>();
  const exits = new Set<string>();
  const nextOf = (s: Screen): string | undefined => doc.screens[(index.get(s.id) ?? -1) + 1]?.id;
  const addTarget = (s: Screen, target: BranchTarget) => {
    exits.add(s.id);
    if (target.kind === 'finish') finishing.add(s.id);
    else if (target.kind === 'screen') edges.get(s.id)?.add(target.screenId);
    else {
      const n = nextOf(s);
      if (n) edges.get(s.id)?.add(n);
      else finishing.add(s.id);
    }
  };
  /** Leaving with «next» (or «branch») evaluates the screen's branches first (L-02). */
  const leaveNext = (s: Screen) => {
    for (const b of s.branches) addTarget(s, b.to);
    addTarget(s, { kind: 'next' });
  };
  const applyActions = (s: Screen, actions: readonly Action[]) => {
    for (const [a] of walkActions(actions, [])) {
      if (a.kind === 'goTo') {
        if (a.to === 'screen' && a.screenId) addTarget(s, { kind: 'screen', screenId: a.screenId });
        else if (a.to === 'next' || a.to === 'branch') leaveNext(s);
        else exits.add(s.id); // «back» is an exit, its target is wherever the participant came from
      }
      if (a.kind === 'finish') {
        exits.add(s.id);
        finishing.add(s.id);
      }
    }
  };
  for (const s of doc.screens) {
    if (s.timer) addTarget(s, s.timer.onExpire);
    for (const r of s.rules) applyActions(s, r.do);
    for (const r of doc.rules) applyActions(s, r.do);
    for (const b of walkBlocks(s.blocks)) {
      for (const r of b.rules) applyActions(s, r.do);
      if (b.type === 'singleChoice' && b.props.autoAdvance) leaveNext(s);
      if (b.type === 'video' && b.props.nextOnEnd) leaveNext(s);
    }
  }
  return { edges, finishing, exits };
}

/** Tarjan's strongly connected components. */
function stronglyConnected(nodes: string[], edges: Map<string, Set<string>>): string[][] {
  let counter = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  const visit = (v: string) => {
    idx.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      out.push(comp);
    }
  };
  for (const n of nodes) if (!idx.has(n)) visit(n);
  return out;
}

export function validateDocument(doc: ProjectDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (code: ValidationIssue['code'], path: Path, message: string, severity: ValidationIssue['severity'] = 'error') =>
    issues.push({ code, severity, path, message });

  const screenIds = new Set(doc.screens.map((s) => s.id));
  const variables = new Set(doc.variables.map((v) => v.id));
  const blockScreen = new Map<string, string>();
  const blocks = new Map<string, Block>();
  const optionIds = new Set<string>();
  for (const s of doc.screens) {
    for (const b of walkBlocks(s.blocks)) {
      blockScreen.set(b.id, s.id);
      blocks.set(b.id, b);
      if (b.type === 'singleChoice' || b.type === 'multiChoice') b.props.options.forEach((o) => optionIds.add(o.id));
    }
  }
  const screenName = (id: string) => doc.screens.find((s) => s.id === id)?.name ?? id;

  // ── References (L-08, SC-07) ────────────────────────────────────────────────
  const checkBlock = (id: string, path: Path, screen?: Screen) => {
    if (!blocks.has(id)) err('MISSING_BLOCK', path, `Правило ссылается на удалённый блок (${id})`);
    else if (screen && blockScreen.get(id) !== screen.id)
      err('BLOCK_ON_OTHER_SCREEN', path, `Правило экрана «${screen.name}» ссылается на блок с экрана «${screenName(blockScreen.get(id)!)}»`);
  };
  const checkVariable = (id: string, path: Path) => {
    if (!variables.has(id)) err('MISSING_VARIABLE', path, `Ссылка на удалённую переменную (${id})`);
  };
  const checkCondition = (c: Condition | undefined, path: Path, screen?: Screen) => {
    for (const cond of walkConditions(c)) {
      const refs = conditionRefs(cond);
      refs.blocks.forEach((id) => checkBlock(id, path, screen));
      refs.questions.forEach((id) => checkBlock(id, path));
      refs.variables.forEach((id) => checkVariable(id, path));
      refs.options.forEach((id) => {
        if (!optionIds.has(id)) err('MISSING_OPTION', path, `Ссылка на удалённый вариант ответа (${id})`);
      });
    }
  };

  for (const { rule, path, screen } of collectRules(doc)) {
    triggerBlocks(rule.when).forEach((id) => checkBlock(id, [...path, 'when'], screen));
    if (rule.when.kind === 'variableChange') checkVariable(rule.when.variableId, [...path, 'when']);
    checkCondition(rule.if, [...path, 'if'], screen);
    const gesture = GESTURE_TRIGGERS.includes(rule.when.kind);
    for (const [a, p] of walkActions(rule.do, [...path, 'do'])) {
      const refs = actionRefs(a);
      refs.blocks.forEach((id) => checkBlock(id, p, screen));
      refs.variables.forEach((id) => checkVariable(id, p));
      refs.screens.forEach((id) => {
        if (!screenIds.has(id)) err('MISSING_SCREEN', p, `Переход на удалённый экран (${id})`);
      });
      refs.options.forEach((id) => {
        if (!optionIds.has(id)) err('MISSING_OPTION', p, `Ссылка на удалённый вариант ответа (${id})`);
      });
      for (const c of actionConditions(a)) checkCondition(c, p, screen);
      if ((a.kind === 'openLink' || a.kind === 'copyText') && !gesture) {
        err(
          'LINK_WITHOUT_GESTURE',
          p,
          a.kind === 'openLink'
            ? 'Ссылку можно открыть только по действию участника (нажатие, свайп, перетаскивание), а не автоматически'
            : 'Скопировать текст можно только по действию участника',
        );
      }
    }
  }

  doc.screens.forEach((s, si) => {
    s.branches.forEach((b, bi) => {
      checkCondition(b.if, ['screens', si, 'branches', bi, 'if'], s);
      if (b.to.kind === 'screen' && !screenIds.has(b.to.screenId))
        err('MISSING_SCREEN', ['screens', si, 'branches', bi], `Ветка ведёт на удалённый экран (${b.to.screenId})`);
    });
    if (s.timer?.onExpire.kind === 'screen' && !screenIds.has(s.timer.onExpire.screenId))
      err('MISSING_SCREEN', ['screens', si, 'timer'], 'Таймер экрана ведёт на удалённый экран');
    if (s.mediaByAnswer && !blocks.has(s.mediaByAnswer.questionBlockId))
      err('MISSING_BLOCK', ['screens', si, 'mediaByAnswer'], 'Медиа-переход по ответу ссылается на удалённый вопрос');

    for (const b of walkBlocks(s.blocks)) {
      const bp: Path = ['screens', si, 'block', b.id];
      checkCondition(b.visibleIf, [...bp, 'visibleIf'], s);
      for (const run of b.textLayer?.paragraphs.flatMap((p) => p.runs) ?? []) {
        if ('v' in run) checkVariable(run.v, [...bp, 'textLayer']);
        if ('answer' in run && !blocks.has(run.answer))
          err('MISSING_BLOCK', [...bp, 'textLayer'], `Текст блока «${b.name}» подставляет ответ на удалённый вопрос`);
      }
      if (b.type === 'singleChoice' || b.type === 'multiChoice') {
        const childIds = new Set(b.children.map((c) => c.id));
        b.props.options.forEach((o, oi) => {
          const child = b.children.find((c) => c.id === o.blockId);
          if (!childIds.has(o.blockId))
            err('OPTION_NOT_CHILD', [...bp, 'props', 'options', oi], `Вариант ответа ${oi + 1} вопроса «${b.name}» не найден внутри вопроса`);
          else if (child && isEmptyBlock(child))
            err('EMPTY_OPTION', [...bp, 'props', 'options', oi], `Вариант ответа ${oi + 1} вопроса «${b.name}» пустой: добавьте текст, картинку или блоки`);
        });
      }
      if ((b.type === 'value' || b.type === 'progress') && b.props.variableId) checkVariable(b.props.variableId, [...bp, 'props']);
      for (const bh of b.behaviors) {
        if (bh.kind === 'spawner') checkBlock(bh.prototypeId, [...bp, 'behaviors'], s);
        if (bh.kind === 'drag') bh.snapToZones.forEach((z) => checkBlock(z, [...bp, 'behaviors'], s));
        if (bh.kind === 'wheel') bh.sectors.forEach((sec) => checkBlock(sec.blockId, [...bp, 'behaviors'], s));
        if (bh.kind === 'flip') [bh.frontId, bh.backId].forEach((id) => checkBlock(id, [...bp, 'behaviors'], s));
      }
    }
  });

  doc.results.forEach((r, ri) => {
    if (!screenIds.has(r.screenId)) err('MISSING_SCREEN', ['results', ri], `Результат «${r.key}» показывает удалённый экран`);
    if (r.kind === 'variable') checkCondition(r.if, ['results', ri, 'if']);
  });

  // ── Graph of screens (L-08) ─────────────────────────────────────────────────
  const { edges, finishing, exits } = screenEdges(doc);
  const last = doc.screens[doc.screens.length - 1]?.id;
  const isFinal = (s: Screen) => s.kind === 'result' || s.id === last || finishing.has(s.id);

  doc.screens.forEach((s, si) => {
    if (!isFinal(s) && !exits.has(s.id)) {
      err('NO_EXIT', ['screens', si], `С экрана «${s.name}» нельзя уйти: добавьте кнопку перехода, таймер или автопереход`);
    }
  });

  const start = doc.screens[0]?.id;
  const reached = new Set<string>();
  const resultScreens = new Set(doc.results.map((r) => r.screenId));
  const queue = start ? [start] : [];
  while (queue.length) {
    const v = queue.shift()!;
    if (reached.has(v)) continue;
    reached.add(v);
    for (const w of edges.get(v) ?? []) queue.push(w);
  }
  doc.screens.forEach((s, si) => {
    if (!reached.has(s.id) && !resultScreens.has(s.id)) {
      err('UNREACHABLE_SCREEN', ['screens', si], `Экран «${s.name}» недостижим: на него не ведёт ни один переход`);
    }
  });

  const finals = new Set(doc.screens.filter(isFinal).map((s) => s.id));
  for (const comp of stronglyConnected([...reached], edges)) {
    const set = new Set(comp);
    const looped = comp.length > 1 || (edges.get(comp[0]!)?.has(comp[0]!) ?? false);
    if (!looped) continue;
    const leaves = comp.some((v) => [...(edges.get(v) ?? [])].some((w) => !set.has(w)));
    const ends = comp.some((v) => finals.has(v));
    if (!leaves && !ends) {
      const names = comp.map((id) => `«${screenName(id)}»`).join(', ');
      err('ENDLESS_LOOP', ['screens'], `Экраны ${names} ведут только друг на друга — из этого круга нет выхода`);
    }
  }

  return issues;
}

/** A block that shows nothing: no text, no media fill or media props, no children. */
export function isEmptyBlock(b: Block): boolean {
  const hasText = b.textLayer ? plainText(b.textLayer).trim().length > 0 : false;
  const hasFill = (b.style.fills ?? []).some((f) => f.kind === 'media');
  const hasMedia = 'media' in b.props && (b.props as { media?: unknown }).media !== null && (b.props as { media?: unknown }).media !== undefined;
  return !hasText && !hasFill && !hasMedia && b.children.length === 0;
}

export const hasErrors = (issues: readonly ValidationIssue[]): boolean => issues.some((i) => i.severity === 'error');
