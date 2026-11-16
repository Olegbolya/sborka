'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReportDialog } from '../play/PlayFooter';
import '../play/player.css';
import './board.css';

interface BoardData {
  title: string;
  slug: string;
  groupBy: 'teams' | 'participants';
  metricTitle: string;
  aggregate: 'sum' | 'avg';
  frozen: boolean;
  total: number;
  rows: Array<{ rank: number; name: string; value: number; count: number }>;
  updatedAt: string;
  theme: { tokens: { colors: Record<string, string>; fonts?: { heading?: { kind?: string; name?: string } } } };
}

/** D-17 · how often the board asks for the standings (the server answers from a cache of three seconds). */
const POLL_MS = 4000;
const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

const FAMILIES: Record<string, string> = { sans: 'system-ui, sans-serif', serif: 'Georgia, serif', mono: 'ui-monospace, monospace', rounded: 'ui-rounded, system-ui, sans-serif' };

/** The text on a colour: dark or light, whichever reads better. */
function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1]!, 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#111111' : '#ffffff';
}

/** D-16, D-17 · the board on the big screen: the places 1…N in the theme of the project, the rows move when places change. */
export function BoardScreen({ code }: { code: string }) {
  const [data, setData] = useState<BoardData | null>(null);
  const [missing, setMissing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [top, setTop] = useState(true);
  const [viewport, setViewport] = useState(800);
  const [report, setReport] = useState(false);
  const [full, setFull] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/board/${encodeURIComponent(code)}`, { cache: 'no-store' });
      if (res.status === 404) {
        setMissing(true);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as BoardData);
      setMissing(false);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [code]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const onResize = () => setViewport(window.innerHeight);
    const onFull = () => setFull(Boolean(document.fullscreenElement));
    onResize();
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onFull);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onFull);
    };
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  };

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const shown = top ? all.slice(0, 10) : all;
    const seen = new Map<string, number>();
    return shown.map((r) => {
      const n = (seen.get(r.name) ?? 0) + 1;
      seen.set(r.name, n);
      return { ...r, id: `${r.name}#${n}` };
    });
  }, [data, top]);

  if (missing) {
    return (
      <main className="bd-root" style={{ ['--bd-bg' as string]: '#FBFAF7', ['--bd-text' as string]: '#1c1b19', ['--bd-muted' as string]: '#6b6a66' }}>
        <h1 className="bd-title" data-testid="board-missing">Табло не найдено</h1>
        <p className="bd-sub">Такого табло нет или создатель его выключил.</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="bd-root" style={{ ['--bd-bg' as string]: '#FBFAF7', ['--bd-text' as string]: '#1c1b19', ['--bd-muted' as string]: '#6b6a66' }}>
        <p className="bd-sub">Загружаем табло…</p>
      </main>
    );
  }

  const c = data.theme.tokens.colors;
  const accent = c.accent ?? c.primary ?? '#E4572E';
  const font = data.theme.tokens.fonts?.heading;
  const vars = {
    '--bd-bg': c.background ?? '#FBFAF7',
    '--bd-text': c.text ?? '#1c1b19',
    '--bd-muted': c.muted ?? '#6b6a66',
    '--bd-surface': c.surface ?? '#ffffff',
    '--bd-accent': accent,
    '--bd-on-accent': onColor(accent),
    '--bd-line': c.muted ?? '#cccccc',
    fontFamily: FAMILIES[font?.kind === 'system' ? (font.name ?? 'sans') : 'sans'],
  } as React.CSSProperties;

  // The rows share the height that is left under the head: from 44 to 110 pixels each; a longer list scrolls with the page.
  const rowH = Math.round(Math.max(44, Math.min(110, (viewport - 240) / Math.max(1, rows.length))));
  const fontPx = Math.round(rowH * 0.42);
  const what = data.groupBy === 'teams' ? (data.aggregate === 'avg' ? `${data.metricTitle}: среднее по команде` : `${data.metricTitle}: сумма по команде`) : data.metricTitle;

  return (
    <main className="bd-root" style={vars} data-testid="board">
      <header className="bd-head">
        <div>
          <h1 className="bd-title" data-testid="board-title">
            {data.title}
            {data.frozen && <span className="bd-frozen" data-testid="board-frozen">Итоги подведены</span>}
          </h1>
          <p className="bd-sub">
            {what} · прохождений: <span data-testid="board-total">{data.total}</span>
          </p>
        </div>
        <div className="bd-tools">
          <button type="button" className="bd-btn" aria-pressed={top} onClick={() => setTop(true)} data-testid="board-top">
            Топ-10
          </button>
          <button type="button" className="bd-btn" aria-pressed={!top} onClick={() => setTop(false)} data-testid="board-all">
            Все
          </button>
          <button type="button" className="bd-btn" onClick={toggleFull} data-testid="board-full">
            {full ? 'Выйти из полного экрана' : 'Полный экран'}
          </button>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="bd-empty" data-testid="board-empty">Пока никто не закончил. Как только кто-то пройдёт до конца, он появится здесь.</p>
      ) : (
        <ol className="bd-list" style={{ height: rows.length * rowH, fontSize: fontPx, listStyle: 'none', margin: 0, padding: 0 }} data-testid="board-rows">
          {rows.map((r, i) => (
            <li key={r.id} className="bd-row" data-top={r.rank <= 3} data-testid="board-row" style={{ height: rowH - 8, transform: `translateY(${i * rowH}px)` }}>
              <span className="bd-rank">{r.rank}</span>
              <span className="bd-name">
                {r.name}
                {data.groupBy === 'teams' && <span className="bd-count">{r.count} чел.</span>}
              </span>
              <span className="bd-value">{numberFormat.format(r.value)}</span>
            </li>
          ))}
        </ol>
      )}

      <footer className="bd-foot">
        <span>
          {offline ? 'Нет связи — пробуем снова. ' : ''}
          Обновляется само, раз в несколько секунд.
        </span>
        <span>
          Табло показывает только итоги.{' '}
          <button type="button" className="bd-link" onClick={() => setReport(true)} data-testid="board-report">
            Пожаловаться
          </button>
        </span>
      </footer>
      {report && <ReportDialog slug={data.slug} onClose={() => setReport(false)} />}
    </main>
  );
}
