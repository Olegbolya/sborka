'use client';
import { type BranchRule, type ProjectDocument, type ValidationIssue, analyzeScreenGraph, createId, validateDocument } from '@blokum/schema';
import { useMemo, useState } from 'react';
import { newBranch, resultScreens, setBranches, setResults, setSettings } from '../../lib/editor/logic';
import { layoutGraph } from '../../lib/editor/graph';
import { locateIssue } from '../../lib/editor/issue-location';
import { ConditionEditor } from './ConditionEditor';
import { NumberInput, SelectInput, TextInput, Toggle } from './controls';
import { useEditor, useEnv } from './context';
import { Dialog } from './Dialog';

type Tab = 'graph' | 'branches' | 'results' | 'issues';
const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ['graph', 'Схема'],
  ['branches', 'Ветвление'],
  ['results', 'Результаты'],
  ['issues', 'Проверка'],
];

/** L-02…L-08 · the logic of the whole passage: the graph of screens, branches, results, settings and the check before publishing. */
export function LogicDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const issues = useMemo(() => validateDocument(doc), [doc]);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const [tab, setTab] = useState<Tab>('graph');
  const [branchScreen, setBranchScreen] = useState<string | null>(null);
  return (
    <Dialog title="Логика сборки" onClose={onClose} wide>
      <div className="ed-tabs" role="tablist">
        {TABS.map(([id, title]) => (
          <button key={id} type="button" role="tab" className="ed-tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {title}
            {id === 'issues' && issues.length > 0 ? ` (${issues.length})` : ''}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={TABS.find(([id]) => id === tab)![1]} className="ed-logic">
        {tab === 'graph' && <GraphTab doc={doc} onOpenBranches={(id) => (setBranchScreen(id), setTab('branches'))} />}
        {tab === 'branches' && <BranchesTab doc={doc} screenId={branchScreen ?? doc.screens[0]!.id} onScreen={setBranchScreen} />}
        {tab === 'results' && <ResultsTab doc={doc} />}
        {tab === 'issues' && <IssuesTab issues={issues} errors={errors} onClose={onClose} onTab={(t, screenId) => (setBranchScreen(screenId ?? null), setTab(t))} />}
      </div>
      <div className="ed-actions">
        <button type="button" className="ed-btn" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </Dialog>
  );
}

// ── Схема ─────────────────────────────────────────────────────────────────────
function GraphTab({ doc, onOpenBranches }: { doc: ProjectDocument; onOpenBranches: (screenId: string) => void }) {
  const graph = useMemo(() => analyzeScreenGraph(doc), [doc]);
  const layout = useMemo(() => layoutGraph(doc.screens.map((s) => s.id), graph.edges, doc.screens[0]!.id), [doc.screens, graph.edges]);
  const name = (id: string) => doc.screens.find((s) => s.id === id)?.name ?? id;
  const W = 150;
  const H = 44;
  const point = (id: string) => layout.nodes.get(id)!;
  const stateOf = (id: string) => (graph.unreachable.has(id) ? 'unreachable' : graph.noExit.has(id) ? 'noexit' : graph.inLoop.has(id) ? 'loop' : 'ok');
  return (
    <div>
      <div className="ed-graph" style={{ overflow: 'auto' }}>
        <svg role="img" aria-label="Схема переходов между экранами" width={layout.width} height={layout.height} data-testid="screen-graph">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
            </marker>
          </defs>
          {graph.edges.map(([from, to], i) => {
            const a = point(from);
            const b = point(to);
            const back = b.col <= a.col;
            const x1 = a.x + (back ? 0 : W);
            const y1 = a.y + H / 2;
            const x2 = b.x + (back ? W : 0);
            const y2 = b.y + H / 2;
            const lift = back ? 34 + Math.abs(a.col - b.col) * 6 : 0;
            const d = back ? `M${a.x + W / 2} ${a.y + H} C${a.x + W / 2} ${a.y + H + lift} ${b.x + W / 2} ${b.y + H + lift} ${b.x + W / 2} ${b.y + H}` : `M${x1} ${y1} C${x1 + 30} ${y1} ${x2 - 30} ${y2} ${x2} ${y2}`;
            return <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray={back ? '5 4' : undefined} opacity={0.7} markerEnd="url(#arrow)" data-edge={`${from}>${to}`} data-back={back || undefined} />;
          })}
          {doc.screens.map((s) => {
            const p = point(s.id);
            const st = stateOf(s.id);
            return (
              <g key={s.id} transform={`translate(${p.x} ${p.y})`} data-screen-node={s.id} data-state={st} tabIndex={0} role="button" aria-label={`Экран «${s.name}»: ${STATE_TITLES[st]}`} onClick={() => onOpenBranches(s.id)} onKeyDown={(e) => e.key === 'Enter' && onOpenBranches(s.id)} style={{ cursor: 'pointer' }}>
                <rect width={W} height={H} rx={8} fill="var(--bg)" stroke={STATE_COLORS[st]} strokeWidth={st === 'ok' ? 1.5 : 3} strokeDasharray={st === 'unreachable' ? '6 4' : undefined} />
                <text x={W / 2} y={H / 2 + 5} textAnchor="middle" fontSize={14} fill="currentColor">
                  {s.name.length > 18 ? `${s.name.slice(0, 17)}…` : s.name}
                </text>
                {graph.finals.has(s.id) && <text x={W - 8} y={14} textAnchor="end" fontSize={11} fill="currentColor">⚑</text>}
              </g>
            );
          })}
        </svg>
      </div>
      <ul className="ed-list" aria-label="Что показывает схема" data-testid="graph-summary">
        <li>Сплошная стрелка — переход вперёд, пунктирная — возврат на прежний экран. ⚑ — экран, на котором сборка заканчивается.</li>
        {graph.unreachable.size > 0 && <li data-problem="unreachable">Недостижимые экраны (красная рамка): {[...graph.unreachable].map(name).join(', ')}.</li>}
        {graph.noExit.size > 0 && <li data-problem="noexit">Без выхода: {[...graph.noExit].map(name).join(', ')}.</li>}
        {graph.inLoop.size > 0 && <li data-problem="loop">Экраны в круге (жёлтая рамка): {[...graph.inLoop].map(name).join(', ')}.</li>}
        {graph.endlessLoops.length > 0 && <li data-problem="endless">Круг без выхода: {graph.endlessLoops.map((c) => c.map(name).join(' → ')).join('; ')}.</li>}
        {graph.unreachable.size + graph.noExit.size + graph.inLoop.size === 0 && <li>Все экраны достижимы, кругов нет.</li>}
      </ul>
      <p className="ed-hint">Нажмите на экран, чтобы настроить его ветки.</p>
    </div>
  );
}

const STATE_TITLES = { ok: 'всё в порядке', unreachable: 'недостижим', noexit: 'нет выхода', loop: 'в круге переходов' } as const;
const STATE_COLORS = { ok: 'currentColor', unreachable: '#d33', noexit: '#d33', loop: '#d9a300' } as const;

// ── Ветвление ─────────────────────────────────────────────────────────────────
const TARGETS: ReadonlyArray<readonly [string, string]> = [
  ['next', 'Следующий экран'],
  ['screen', 'Другой экран'],
  ['finish', 'Закончить сборку'],
];

function BranchesTab({ doc, screenId, onScreen }: { doc: ProjectDocument; screenId: string; onScreen: (id: string) => void }) {
  const apply = useEditor((s) => s.apply);
  const screen = doc.screens.find((s) => s.id === screenId) ?? doc.screens[0]!;
  const write = (change: (b: BranchRule[]) => unknown, label: string) => apply(setBranches(screen.id, change), { label, ...(label === 'Ветки экрана' ? { mergeKey: `branches:${screen.id}` } : {}) });
  return (
    <div>
      <SelectInput<string> control="branch-screen" label="Экран" value={screen.id} options={doc.screens.map((s, i) => [s.id, `${i + 1}. ${s.name}`] as const)} onChange={onScreen} />
      <p className="ed-hint">Ветки проверяются сверху вниз; сработает первая подходящая. Если не подошла ни одна — идём на следующий экран.</p>
      {screen.branches.length === 0 && <p className="ed-hint">У этого экрана нет веток.</p>}
      {screen.branches.map((b, i) => (
        <div key={b.id} className="ed-layer" data-branch={i}>
          <div className="ed-layerhead">
            <strong>Ветка {i + 1}</strong>
            <button type="button" className="ed-btn small" aria-label={`Ветка ${i + 1}: выше`} disabled={i === 0} onClick={() => write((all) => move(all, i, i - 1), 'Порядок веток')}>
              ↑
            </button>
            <button type="button" className="ed-btn small" aria-label={`Ветка ${i + 1}: ниже`} disabled={i === screen.branches.length - 1} onClick={() => write((all) => move(all, i, i + 1), 'Порядок веток')}>
              ↓
            </button>
            <button type="button" className="ed-btn small danger" aria-label={`Ветка ${i + 1}: убрать`} onClick={() => write((all) => all.filter((_x, j) => j !== i), 'Убрать ветку')}>
              Убрать
            </button>
          </div>
          <p className="ed-hint">Если…</p>
          <ConditionEditor label={`Ветка ${i + 1}`} value={b.if} onChange={(c) => write((all) => all.map((x, j) => (j === i ? { ...x, if: c } : x)), 'Ветки экрана')} />
          <p className="ed-hint">…то перейти:</p>
          <SelectInput<string>
            control={`branch-${i}.to`}
            label={`Ветка ${i + 1}: куда`}
            value={b.to.kind}
            options={TARGETS}
            onChange={(kind) => write((all) => all.map((x, j) => (j === i ? { ...x, to: kind === 'screen' ? { kind: 'screen', screenId: doc.screens.find((s) => s.id !== screen.id)?.id ?? screen.id } : { kind } } : x)), 'Ветки экрана')}
          />
          {b.to.kind === 'screen' && (
            <SelectInput<string>
              control={`branch-${i}.screen`}
              label={`Ветка ${i + 1}: экран`}
              value={doc.screens.some((s) => s.id === (b.to as { screenId: string }).screenId) ? (b.to as { screenId: string }).screenId : null}
              options={doc.screens.map((s, k) => [s.id, `${k + 1}. ${s.name}`] as const)}
              onChange={(id) => write((all) => all.map((x, j) => (j === i ? { ...x, to: { kind: 'screen', screenId: id } } : x)), 'Ветки экрана')}
            />
          )}
        </div>
      ))}
      <button type="button" className="ed-btn small" disabled={screen.branches.length >= 50} onClick={() => write((all) => [...all, newBranch(doc, screen)], 'Добавить ветку')}>
        Добавить ветку
      </button>
    </div>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x as T);
  return next;
}

// ── Результаты ────────────────────────────────────────────────────────────────
type Result = ProjectDocument['results'][number];

function ResultsTab({ doc }: { doc: ProjectDocument }) {
  const apply = useEditor((s) => s.apply);
  const screens = resultScreens(doc);
  const write = (change: (r: Result[]) => unknown, label: string, mergeKey?: string) => apply(setResults(change), { label, ...(mergeKey ? { mergeKey } : {}) });
  const patch = (id: string, change: Partial<Result> | ((r: Result) => Result), mergeKey?: string) =>
    write((all) => all.map((r) => (r.id === id ? (typeof change === 'function' ? change(r) : ({ ...r, ...change } as Result)) : r)), 'Результат', mergeKey ? `result:${id}:${mergeKey}` : undefined);
  const firstScreen = screens[0]!.id;
  const add = (kind: Result['kind']) =>
    write(
      (all) => [
        ...all,
        kind === 'scoreRange'
          ? { kind, id: createId(), key: `Результат ${all.length + 1}`, screenId: firstScreen, min: 0, max: 10 }
          : kind === 'tag'
            ? { kind, id: createId(), key: `Результат ${all.length + 1}`, screenId: firstScreen, tag: 'тег' }
            : { kind, id: createId(), key: `Результат ${all.length + 1}`, screenId: firstScreen, if: { kind: 'variable', variableId: doc.variables[0]?.id ?? 'variable_unset', op: 'gte', value: 1 } },
      ],
      'Добавить результат',
    );
  return (
    <div>
      <p className="ed-hint">Результаты проверяются сверху вниз; побеждает первый подходящий. В тексте экрана результата можно вставить «{'{{результат}}'}», «{'{{баллы}}'}» и «{'{{максимум}}'}».</p>
      {doc.results.length === 0 && <p className="ed-hint">Результатов пока нет: сборка закончится без итогового экрана.</p>}
      {doc.results.map((r, i) => (
        <div key={r.id} className="ed-layer" data-result={i}>
          <div className="ed-layerhead">
            <strong>
              Результат {i + 1} · {r.kind === 'scoreRange' ? 'по баллам' : r.kind === 'tag' ? 'по меткам (личностный тест)' : 'по переменной'}
            </strong>
            <button type="button" className="ed-btn small" aria-label={`Результат ${i + 1}: выше`} disabled={i === 0} onClick={() => write((all) => move(all, i, i - 1), 'Порядок результатов')}>
              ↑
            </button>
            <button type="button" className="ed-btn small" aria-label={`Результат ${i + 1}: ниже`} disabled={i === doc.results.length - 1} onClick={() => write((all) => move(all, i, i + 1), 'Порядок результатов')}>
              ↓
            </button>
            <button type="button" className="ed-btn small danger" aria-label={`Результат ${i + 1}: убрать`} onClick={() => write((all) => all.filter((x) => x.id !== r.id), 'Убрать результат')}>
              Убрать
            </button>
          </div>
          <TextInput control={`result-${i}.key`} label={`Результат ${i + 1}: название`} value={r.key} max={60} onChange={(v) => v.trim() && patch(r.id, { key: v }, 'key')} />
          <SelectInput<string>
            control={`result-${i}.screen`}
            label={`Результат ${i + 1}: какой экран показать`}
            value={doc.screens.some((s) => s.id === r.screenId) ? r.screenId : null}
            options={screens.map((s) => [s.id, `${s.name}${s.kind === 'result' ? ' (результат)' : ''}`] as const)}
            onChange={(id) => patch(r.id, { screenId: id })}
          />
          {r.kind === 'scoreRange' && (
            <div className="ed-grid">
              <NumberInput control={`result-${i}.min`} label={`Результат ${i + 1}: баллов от`} value={r.min} step={1} onChange={(n) => patch(r.id, { min: n }, 'min')} />
              <NumberInput control={`result-${i}.max`} label={`Результат ${i + 1}: баллов до`} value={r.max} step={1} onChange={(n) => patch(r.id, { max: n }, 'max')} />
            </div>
          )}
          {r.kind === 'tag' && <TextInput control={`result-${i}.tag`} label={`Результат ${i + 1}: метка`} value={r.tag} max={40} onChange={(v) => v.trim() && patch(r.id, { tag: v.trim() }, 'tag')} />}
          {r.kind === 'variable' && <ConditionEditor label={`Результат ${i + 1}`} value={r.if} onChange={(c) => patch(r.id, { if: c }, 'if')} />}
        </div>
      ))}
      <div className="ed-actions">
        <button type="button" className="ed-btn small" onClick={() => add('scoreRange')}>
          Добавить результат по баллам
        </button>
        <button type="button" className="ed-btn small" onClick={() => add('tag')}>
          Добавить результат по метке
        </button>
        <button type="button" className="ed-btn small" onClick={() => add('variable')}>
          Добавить результат по переменной
        </button>
      </div>
      <SettingsBlock doc={doc} />
    </div>
  );
}

function SettingsBlock({ doc }: { doc: ProjectDocument }) {
  const apply = useEditor((s) => s.apply);
  const st = doc.settings;
  const set = (change: Partial<typeof st>, label: string) => apply(setSettings((s) => ({ ...s, ...change })), { label });
  return (
    <div className="ed-section" data-testid="passage-settings">
      <h2>Прохождение</h2>
      <SelectInput<string>
        control="settings.feedback"
        label="Когда показывать, верно ли ответили"
        value={st.feedbackMode}
        options={[['instant', 'Сразу после ответа'], ['end', 'В конце'], ['none', 'Не показывать']]}
        onChange={(v) => set({ feedbackMode: v as typeof st.feedbackMode }, 'Обратная связь')}
      />
      <SelectInput<string>
        control="settings.tie"
        label="Если в личностном тесте ничья"
        value={st.tieBreak}
        options={[['first', 'Берём первый по порядку'], ['random', 'Выбираем случайно']]}
        onChange={(v) => set({ tieBreak: v as typeof st.tieBreak }, 'Ничья в тесте')}
      />
      <Toggle control="settings.back" label="Можно вернуться назад" value={st.allowBack} onChange={(v) => set({ allowBack: v }, 'Кнопка «Назад»')} />
      <Toggle control="settings.progress" label="Показывать, сколько экранов осталось" value={st.showProgress} onChange={(v) => set({ showProgress: v }, 'Показ прогресса')} />
    </div>
  );
}

// ── Проверка ──────────────────────────────────────────────────────────────────
function IssuesTab({ issues, errors, onClose, onTab }: { issues: ValidationIssue[]; errors: number; onClose: () => void; onTab: (t: Tab, screenId?: string) => void }) {
  const doc = useEditor((s) => s.doc);
  const select = useEditor((s) => s.select);
  const selectScreen = useEditor((s) => s.selectScreen);

  const { focus } = useEnv();
  /** Takes the person to the place the issue is about (SC-07): the block and its rule, the panel of a screen's rules, the branch, the result. */
  const show = (issue: ValidationIssue) => {
    const place = locateIssue(doc, issue);
    if (place.kind === 'result') return onTab('results');
    if (place.kind === 'branch') return onTab('branches', place.screenId);
    if (place.kind === 'screen-rule' || place.kind === 'doc-rule') {
      onClose();
      focus.request({ dialog: place.kind === 'doc-rule' ? { tab: 'doc' } : { tab: 'screen', ...(place.screenId ? { screenId: place.screenId } : {}) }, ...(place.ruleId ? { ruleId: place.ruleId } : {}) });
      return;
    }
    if (place.screenId && place.blockId) {
      select(place.screenId, [place.blockId]);
      onClose();
      focus.request({ ...(place.tab ? { tab: place.tab } : {}), ...(place.ruleId ? { ruleId: place.ruleId } : {}) });
      return;
    }
    if (place.screenId) selectScreen(place.screenId);
    else selectScreen(doc.screens[0]!.id);
    onClose();
  };

  return (
    <div>
      <p data-testid="issues-summary" role="status">
        {issues.length === 0 ? 'Проблем не найдено: сборку можно публиковать.' : `Найдено: ошибок — ${errors}, предупреждений — ${issues.length - errors}. Ошибки мешают публикации.`}
      </p>
      <ul className="ed-list" aria-label="Проблемы">
        {issues.map((issue, i) => (
          <li key={i} data-issue={issue.code} data-severity={issue.severity} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ flex: 1 }}>
              <strong>{issue.severity === 'error' ? 'Ошибка' : 'Предупреждение'}.</strong> {issue.message}
              <small className="ed-hint" data-testid="issue-where" style={{ display: 'block' }}>
                Где: {locateIssue(doc, issue).where}
              </small>
            </span>
            <button type="button" className="ed-btn small" onClick={() => show(issue)}>
              Показать
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
