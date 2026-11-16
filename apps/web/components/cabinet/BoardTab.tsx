'use client';
import { useCallback, useEffect, useState } from 'react';

interface Cand {
  id: string;
  name: string;
  screen?: string;
}
interface Settings {
  enabled: boolean;
  groupBy: 'teams' | 'participants';
  metric: 'score' | 'variable';
  metricVariableId: string | null;
  aggregate: 'sum' | 'avg';
  teamBlockId: string | null;
  nickBlockId: string | null;
  consentBlockId: string | null;
  showOnFinish: boolean;
}
interface BoardState {
  allowed: boolean;
  settings: Settings;
  code: string | null;
  frozen: boolean;
  resetAt: string | null;
  published: boolean;
  candidates: { questions: Cand[]; texts: Cand[]; consents: Cand[]; variables: Cand[] };
}
interface Row {
  key: string;
  rank: number;
  name: string;
  value: number;
  count: number;
  hidden: boolean;
}

const NONE = '';
const box = { margin: '0 0 24px' } as const;
const label = { display: 'block', fontSize: 13, margin: '12px 0 4px' } as const;
const field = { padding: '8px 10px', fontSize: 14, borderRadius: 8, border: '1px solid var(--border, #ddd)', background: 'transparent', maxWidth: '100%' } as const;
const btn = { padding: '9px 18px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff' } as const;
const btnSecondary = { padding: '7px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border, #ddd)', cursor: 'pointer', background: 'transparent', color: 'inherit' } as const;
const note = { fontSize: 12, color: 'var(--muted)', margin: '6px 0 0' } as const;

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${url}`, { method, credentials: 'include', headers: body === undefined ? {} : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? `Ошибка ${res.status}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

function Select({ id, text, value, onChange, options, empty }: { id: string; text: string; value: string; onChange: (v: string) => void; options: Cand[]; empty: string }) {
  return (
    <>
      <label style={label} htmlFor={id}>
        {text}
      </label>
      <select id={id} data-testid={id} style={field} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={NONE}>{empty}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.screen ? ` (${o.screen})` : ''}
          </option>
        ))}
      </select>
    </>
  );
}

/** D-13…D-19 · «Табло»: switch on, choose what is counted and by whom, the address and QR, freeze, a new round, hide a row. */
export function BoardTab({ projectId, setError }: { projectId: string; setError: (e: string) => void }) {
  const [state, setState] = useState<BoardState | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await request<BoardState>('GET', `/projects/${projectId}/board`);
      setState(s);
      setForm((f) => f ?? s.settings);
      if (s.code) setRows((await request<{ rows: Row[] }>('GET', `/projects/${projectId}/board/rows`)).rows);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId, setError]);

  useEffect(() => {
    void load();
  }, [load]);

  // The rows change while people finish: look again while the tab is open.
  useEffect(() => {
    if (!state?.code) return;
    const timer = window.setInterval(() => void request<{ rows: Row[] }>('GET', `/projects/${projectId}/board/rows`).then((r) => setRows(r.rows)).catch(() => undefined), 5000);
    return () => window.clearInterval(timer);
  }, [projectId, state?.code]);

  const act = async (run: () => Promise<unknown>) => {
    setError('');
    try {
      await run();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!state || !form) return <p style={note}>Загрузка…</p>;
  const set = (patch: Partial<Settings>) => {
    setSaved(false);
    setForm({ ...form, ...patch });
  };
  const url = state.code ? `${window.location.origin}/b/${state.code}` : null;
  const c = state.candidates;

  return (
    <div data-testid="board-tab">
      {!state.allowed && (
        <p style={note} data-testid="board-plan">
          Табло есть на платных тарифах и с пропуском «Праздник». <a href="/tariffs">Посмотреть тарифы</a>
        </p>
      )}
      {state.allowed && !state.published && <p style={note}>Опубликуйте сборку: табло показывает итоги опубликованной версии.</p>}

      <section style={box}>
        <p style={{ fontSize: 14, margin: '0 0 8px' }}>
          Табло — отдельная страница для большого экрана: в ней итоги тех, кто прошёл сборку до конца. Ответы на вопросы и правильные варианты там не видны.
        </p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
          <input type="checkbox" data-testid="board-enabled" checked={form.enabled} disabled={!state.allowed} onChange={(e) => set({ enabled: e.target.checked })} />
          Включить табло
        </label>

        <label style={label} htmlFor="board-group">Что в строке табло</label>
        <select id="board-group" data-testid="board-group" style={field} value={form.groupBy} onChange={(e) => set({ groupBy: e.target.value as Settings['groupBy'] })}>
          <option value="participants">Участники (каждый — своя строка)</option>
          <option value="teams">Команды (по ответу на вопрос)</option>
        </select>

        {form.groupBy === 'teams' ? (
          <>
            <Select id="board-team" text="Вопрос, ответ на который — команда" value={form.teamBlockId ?? NONE} onChange={(v) => set({ teamBlockId: v || null })} options={c.questions} empty="Выберите вопрос" />
            <label style={label} htmlFor="board-aggregate">Что показывать у команды</label>
            <select id="board-aggregate" data-testid="board-aggregate" style={field} value={form.aggregate} onChange={(e) => set({ aggregate: e.target.value as Settings['aggregate'] })}>
              <option value="sum">Сумму</option>
              <option value="avg">Среднее на человека</option>
            </select>
          </>
        ) : (
          <>
            <Select id="board-nick" text="Поле «Имя для табло»" value={form.nickBlockId ?? NONE} onChange={(v) => set({ nickBlockId: v || null })} options={c.texts} empty="Не выбрано — все будут «Участник N»" />
            <Select id="board-consent" text="Согласие «Показывать моё имя на табло»" value={form.consentBlockId ?? NONE} onChange={(v) => set({ consentBlockId: v || null })} options={c.consents} empty="Не выбрано — имена не показываются" />
            <p style={note}>Имя попадает на табло, только если участник сам поставил отметку согласия. Иначе он виден как «Участник N».</p>
          </>
        )}

        <label style={label} htmlFor="board-metric">Что считать</label>
        <select id="board-metric" data-testid="board-metric" style={field} value={form.metric} onChange={(e) => set({ metric: e.target.value as Settings['metric'] })}>
          <option value="score">Баллы за ответы</option>
          <option value="variable">Числовую переменную из игры</option>
        </select>
        {form.metric === 'variable' && <Select id="board-variable" text="Переменная (она должна сохраняться в ответы)" value={form.metricVariableId ?? NONE} onChange={(v) => set({ metricVariableId: v || null })} options={c.variables} empty="Выберите переменную" />}

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, marginTop: 14 }}>
          <input type="checkbox" checked={form.showOnFinish} onChange={(e) => set({ showOnFinish: e.target.checked })} />
          Кнопка «Открыть табло» в конце прохождения
        </label>
        <p style={note}>Место и число участников можно вставить в текст: «{'{{место}}'}» и «{'{{всего_участников}}'}» (в редакторе — «Системные значения»).</p>

        <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" style={btn} data-testid="board-save" disabled={!state.allowed && form.enabled} onClick={() => void act(async () => { const s = await request<BoardState>('PUT', `/projects/${projectId}/board`, form); setForm(s.settings); setSaved(true); })}>
            Сохранить
          </button>
          {saved && <span style={note} data-testid="board-saved">Сохранено</span>}
        </div>
      </section>

      {state.code && state.settings.enabled && url && (
        <section style={box} data-testid="board-address">
          <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px' }}>Адрес табло</p>
          <p style={{ margin: '0 0 8px', overflowWrap: 'anywhere' }}>
            <a href={url} target="_blank" rel="noopener noreferrer" data-testid="board-link">{url}</a>
          </p>
          <img src={`/api/v1/projects/${projectId}/board/qr.svg`} alt="QR-код табло" width={160} height={160} data-testid="board-qr" style={{ background: '#fff' }} />
          <p style={note}>
            <a href={`/api/v1/projects/${projectId}/board/qr.png`} download>Скачать QR (PNG)</a> · Откройте адрес на проекторе и нажмите «Полный экран».
          </p>
        </section>
      )}

      {state.code && state.settings.enabled && (
        <section style={box} data-testid="board-controls">
          <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>Управление</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={btnSecondary} data-testid="board-freeze" onClick={() => void act(() => request('POST', `/projects/${projectId}/board/freeze`, { frozen: !state.frozen }))}>
              {state.frozen ? 'Продолжить приём прохождений' : 'Подвести итоги'}
            </button>
            {confirmReset ? (
              <>
                <button type="button" style={{ ...btnSecondary, borderColor: '#dc2626', color: '#dc2626' }} data-testid="board-reset-confirm" onClick={() => void act(async () => { await request('POST', `/projects/${projectId}/board/reset`); setConfirmReset(false); })}>
                  Да, обнулить табло
                </button>
                <button type="button" style={btnSecondary} onClick={() => setConfirmReset(false)}>Отмена</button>
              </>
            ) : (
              <button type="button" style={btnSecondary} data-testid="board-reset" onClick={() => setConfirmReset(true)}>
                Новый раунд (обнулить)
              </button>
            )}
          </div>
          <p style={note}>
            {state.frozen ? 'Итоги подведены: новые прохождения в табло не попадают.' : 'Обнуление начинает новый раунд: прежние прохождения остаются в таблице ответов, но на табло не считаются.'}
          </p>
          {rows.length === 0 ? (
            <p style={note}>Пока никто не закончил.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }} data-testid="board-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Место</th>
                  <th style={{ textAlign: 'left' }}>Строка</th>
                  <th style={{ textAlign: 'right' }}>Значение</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} style={{ opacity: r.hidden ? 0.5 : 1, borderTop: '1px solid var(--border, #eee)' }}>
                    <td>{r.rank}</td>
                    <td>
                      {r.name}
                      {r.count > 1 ? ` · ${r.count} чел.` : ''}
                      {r.hidden ? ' · скрыта' : ''}
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.value}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" style={btnSecondary} data-testid={`board-hide-${r.name}`} onClick={() => void act(() => request('POST', `/projects/${projectId}/board/hide`, { key: r.key, hidden: !r.hidden }))}>
                        {r.hidden ? 'Показать' : 'Скрыть'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
