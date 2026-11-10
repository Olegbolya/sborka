'use client';
import { useEffect, useState } from 'react';

interface NamedCount {
  key: string;
  name: string;
  count: number;
}

interface Analytics {
  range: { from: string; to: string };
  totals: { opens: number; starts: number; completions: number; completionRate: number | null; avgDurationMs: number | null };
  byDay: Array<{ day: string; opens: number; starts: number; completions: number }>;
  byAccessPoint: Array<{ id: string; label: string; kind: string; opens: number; starts: number; completions: number }>;
  byDevice: Array<{ device: string; starts: number; completions: number }>;
  funnel: Array<{ screenId: string; name: string; reached: number; leftHere: number; avgTimeMs: number | null }>;
  questions: Array<{ blockId: string; name: string; screen: string; answered: number; options: NamedCount[] }>;
  results: NamedCount[];
  values: Array<{ variableId: string; name: string; count: number; min: number | null; max: number | null; avg: number | null; top: NamedCount[] }>;
}

const DEVICES: Record<string, string> = { PHONE: 'Телефон', TABLET: 'Планшет', DESKTOP: 'Компьютер', UNKNOWN: 'Не определено' };
const PERIODS = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: 90, label: '90 дней' },
];

const st = {
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 },
  card: { padding: '14px 16px', borderRadius: 10, border: '1px solid var(--border, #eee)' },
  cardValue: { fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 },
  cardLabel: { fontSize: 12, color: 'var(--muted)', marginTop: 4 },
  section: { margin: '0 0 28px' },
  h3: { fontSize: 15, margin: '0 0 10px' },
  note: { fontSize: 12, color: 'var(--muted)', margin: '0 0 10px' },
  row: { display: 'grid', gridTemplateColumns: 'minmax(90px, 30%) 1fr auto', gap: 10, alignItems: 'center', padding: '5px 0', fontSize: 13 },
  barBack: { height: 12, borderRadius: 6, background: 'var(--border, #eee)', overflow: 'hidden' },
  period: (active: boolean) => ({ padding: '6px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border, #ddd)', cursor: 'pointer', background: active ? 'var(--accent)' : 'transparent', color: active ? '#fff' : 'inherit' }),
};

const duration = (ms: number | null): string => {
  if (ms === null) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${s % 60} с`;
};
const shortDay = (day: string): string => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
const iso = (d: Date): string => d.toISOString().slice(0, 10);

function Bars({ rows, empty }: { rows: Array<{ label: string; value: number; extra?: string }>; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p style={st.note}>{empty}</p>;
  return (
    <div>
      {rows.map((r) => (
        <div key={r.label} style={st.row}>
          <span style={{ overflowWrap: 'anywhere' }}>{r.label}</span>
          <div style={st.barBack} aria-hidden="true">
            <div style={{ width: `${(r.value / max) * 100}%`, height: '100%', background: 'var(--accent)' }} />
          </div>
          <span style={{ whiteSpace: 'nowrap' }}>
            {r.value}
            {r.extra ? ` · ${r.extra}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

/** D-05 · the analytics of a project: the totals, the days, the points of access, the devices, the funnel by screens, the answers, the results. */
export function AnalyticsTab({ projectId, setError }: { projectId: string; setError: (e: string) => void }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 86_400_000);
    fetch(`/api/v1/projects/${projectId}/analytics?from=${iso(from)}&to=${iso(to)}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? `Ошибка ${res.status}`);
        return res.json() as Promise<Analytics>;
      })
      .then((d) => active && setData(d))
      .catch((e: Error) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId, days, setError]);

  const totals = data?.totals;
  const dayMax = Math.max(1, ...(data?.byDay.map((d) => Math.max(d.starts, d.opens)) ?? [1]));

  return (
    <div data-testid="analytics">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }} role="group" aria-label="Период">
        {PERIODS.map((p) => (
          <button key={p.days} type="button" style={st.period(days === p.days)} onClick={() => setDays(p.days)} aria-pressed={days === p.days}>
            {p.label}
          </button>
        ))}
      </div>
      {loading && !data && <p style={st.note}>Считаем…</p>}
      {totals && data && (
        <>
          <div style={st.cards}>
            <div style={st.card}><div style={st.cardValue}>{totals.opens}</div><div style={st.cardLabel}>Открытий по ссылке или QR</div></div>
            <div style={st.card}><div style={st.cardValue}>{totals.starts}</div><div style={st.cardLabel}>Начали проходить</div></div>
            <div style={st.card}><div style={st.cardValue}>{totals.completions}</div><div style={st.cardLabel}>Прошли до конца</div></div>
            <div style={st.card}><div style={st.cardValue}>{totals.completionRate === null ? '—' : `${totals.completionRate}%`}</div><div style={st.cardLabel}>Доля дошедших до конца</div></div>
            <div style={st.card}><div style={st.cardValue}>{duration(totals.avgDurationMs)}</div><div style={st.cardLabel}>Среднее время прохождения</div></div>
          </div>

          <section style={st.section}>
            <h3 style={st.h3}>По дням</h3>
            {data.byDay.length === 0 ? (
              <p style={st.note}>За этот период прохождений ещё не было.</p>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120, overflowX: 'auto' }} role="img" aria-label="Начавшие проходить по дням">
                {data.byDay.map((d) => (
                  <div key={d.day} title={`${shortDay(d.day)}: открытий ${d.opens}, начали ${d.starts}, прошли ${d.completions}`} style={{ flex: '1 0 14px', minWidth: 14, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                    <div style={{ height: `${(d.starts / dayMax) * 100}%`, minHeight: d.starts ? 2 : 0, background: 'var(--accent)', borderRadius: '3px 3px 0 0', opacity: 0.35 }} />
                    <div style={{ height: `${(d.completions / dayMax) * 100}%`, minHeight: d.completions ? 2 : 0, background: 'var(--accent)' }} />
                    <span style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center' }}>{shortDay(d.day)}</span>
                  </div>
                ))}
              </div>
            )}
            <p style={st.note}>Светлый столбик — начали, тёмный — прошли до конца.</p>
          </section>

          <section style={st.section}>
            <h3 style={st.h3}>Воронка по экранам</h3>
            <p style={st.note}>Сколько человек дошли до экрана, сколько остановились на нём и сколько времени в среднем отвечали на нём.</p>
            <Bars empty="Прохождений ещё нет." rows={data.funnel.map((f) => ({ label: f.name, value: f.reached, extra: `ушли здесь: ${f.leftHere}${f.avgTimeMs !== null ? `, ${duration(f.avgTimeMs)}` : ''}` }))} />
          </section>

          {data.questions.length > 0 && (
            <section style={st.section}>
              <h3 style={st.h3}>Ответы на вопросы</h3>
              {data.questions.map((q) => (
                <div key={q.blockId} style={{ marginBottom: 14 }}>
                  <strong style={{ fontSize: 14 }}>{q.name}</strong>
                  <span style={st.note}> {q.screen ? `· ${q.screen} ` : ''}· ответили: {q.answered}</span>
                  <Bars empty="Вариантов нет." rows={q.options.map((o) => ({ label: o.name, value: o.count, extra: q.answered ? `${Math.round((o.count / q.answered) * 100)}%` : undefined }))} />
                </div>
              ))}
            </section>
          )}

          {data.results.length > 0 && (
            <section style={st.section}>
              <h3 style={st.h3}>Результаты</h3>
              <Bars empty="" rows={data.results.map((r) => ({ label: r.name, value: r.count }))} />
            </section>
          )}

          {data.values.length > 0 && (
            <section style={st.section}>
              <h3 style={st.h3}>Значения игр</h3>
              <p style={st.note}>Их считает устройство участника, сервер проверяет только правдоподобие.</p>
              {data.values.map((v) => (
                <div key={v.variableId} style={{ marginBottom: 10, fontSize: 13 }}>
                  <strong>{v.name}</strong> · записей: {v.count}
                  {v.avg !== null ? ` · наименьшее ${v.min}, наибольшее ${v.max}, среднее ${v.avg}` : ''}
                </div>
              ))}
            </section>
          )}

          <section style={st.section}>
            <h3 style={st.h3}>Откуда пришли</h3>
            <Bars empty="Точек доступа нет." rows={data.byAccessPoint.map((p) => ({ label: p.label, value: p.starts, extra: `открытий ${p.opens}, дошли до конца ${p.completions}` }))} />
          </section>

          <section style={st.section}>
            <h3 style={st.h3}>Устройства</h3>
            <Bars empty="Прохождений ещё нет." rows={data.byDevice.map((d) => ({ label: DEVICES[d.device] ?? 'Не определено', value: d.starts, extra: `до конца ${d.completions}` }))} />
          </section>
        </>
      )}
    </div>
  );
}
