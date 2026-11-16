'use client';
import { useCallback, useEffect, useState } from 'react';

interface Holder {
  sessionId: string;
  startedAt: string;
  status: string;
  who: string | null;
}
interface Place {
  questionBlockId: string;
  question: string;
  optionId: string;
  label: string;
  limit: number;
  used: number;
  holders: Holder[];
}
interface Limits {
  holdHours: number;
  places: Place[];
}

const when = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** D-12 · «Занятые варианты»: how full every limited option is, who holds a place, and a button to let a place go (PL-26). */
export function ChoiceLimitsPanel({ projectId, setError }: { projectId: string; setError: (e: string) => void }) {
  const [data, setData] = useState<Limits | null>(null);

  const load = useCallback(() => {
    fetch(`/api/v1/projects/${projectId}/choice-limits`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? `Ошибка ${res.status}`);
        return res.json() as Promise<Limits>;
      })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [projectId, setError]);

  useEffect(load, [load]);

  const release = (sessionId: string, optionId: string) => {
    fetch(`/api/v1/projects/${projectId}/choice-limits/release`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, optionId }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? `Ошибка ${res.status}`);
        load();
      })
      .catch((e: Error) => setError(e.message));
  };

  if (!data || data.places.length === 0) return null;
  return (
    <section style={{ margin: '0 0 28px' }} data-testid="choice-limits">
      <h3 style={{ fontSize: 15, margin: '0 0 10px' }}>Занятые варианты</h3>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 10px' }}>
        Место держит прохождение до конца или {data.holdHours} ч после последнего действия. Освободите место, если человек ушёл и не вернётся.
      </p>
      {data.places.map((p) => (
        <div key={`${p.questionBlockId}:${p.optionId}`} style={{ marginBottom: 14, fontSize: 13 }} data-testid={`choice-limit-${p.optionId}`}>
          <strong>{p.label}</strong> · {p.question}: занято {p.used} из {p.limit}
          {p.holders.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {p.holders.map((h) => (
                <li key={h.sessionId} style={{ marginBottom: 4 }}>
                  {h.who ?? 'Без имени'} · {when(h.startedAt)} · {h.status === 'COMPLETED' ? 'закончил' : 'проходит'}{' '}
                  <button type="button" className="btn" data-testid={`choice-release-${h.sessionId}`} onClick={() => release(h.sessionId, p.optionId)}>
                    Освободить
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
