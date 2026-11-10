'use client';
import { useState } from 'react';
import { api } from '../../../lib/api-browser';
import { Badge, Field, Notice, css, useAction, useLoad } from '../../../components/admin/ui';

interface Term {
  id: string;
  kind: 'STOP' | 'DOMAIN';
  term: string;
  category: 'A' | 'B' | null;
  weight: number;
  active: boolean;
  note: string;
}

/** The weight from which a stop word stops the publication (STOP_WORD_BLOCK_WEIGHT of @blokum/schema). */
const BLOCK_FROM = 80;

function TermRow({ t, onDone }: { t: Term; onDone: () => void }) {
  const [weight, setWeight] = useState(String(t.weight));
  const { busy, error, ok, run } = useAction(onDone);
  const patch = (body: Record<string, unknown>, done: string) => run(() => api(`/admin/safety-terms/${t.id}`, { method: 'PATCH', body }), done);
  return (
    <tr data-testid={`term-${t.term}`}>
      <td style={css.td}>
        <strong>{t.term}</strong>
        {t.note ? <div style={css.muted}>{t.note}</div> : null}
        <Notice error={error} ok={ok} />
      </td>
      {t.kind === 'STOP' ? (
        <>
          <td style={css.td}>{t.category}</td>
          <td style={css.td}>
            <div style={css.row}>
              <input style={{ ...css.input, width: 70 }} inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} aria-label={`Вес слова ${t.term}`} />
              <button type="button" style={css.btnLight} disabled={busy || weight === String(t.weight)} onClick={() => void patch({ weight: Number(weight) }, 'Вес сохранён')}>Сохранить</button>
            </div>
            <div style={css.muted}>{t.weight >= BLOCK_FROM ? 'останавливает публикацию' : 'случай для модератора'}</div>
          </td>
        </>
      ) : null}
      <td style={css.td}><Badge color={t.active ? '#16a34a' : '#6b665d'}>{t.active ? 'Действует' : 'Выключено'}</Badge></td>
      <td style={css.td}>
        <div style={css.row}>
          <button type="button" style={css.btnLight} disabled={busy} onClick={() => void patch({ active: !t.active }, t.active ? 'Выключено' : 'Включено')}>{t.active ? 'Выключить' : 'Включить'}</button>
          <button type="button" style={css.btnDanger} disabled={busy} onClick={() => void run(() => api(`/admin/safety-terms/${t.id}`, { method: 'DELETE' }), 'Удалено')}>Удалить</button>
        </div>
      </td>
    </tr>
  );
}

function AddForm({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<'STOP' | 'DOMAIN'>('STOP');
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<'A' | 'B'>('B');
  const [weight, setWeight] = useState('60');
  const [note, setNote] = useState('');
  const { busy, error, ok, run } = useAction(onDone);
  const add = async () => {
    const done = await run(() => api('/admin/safety-terms', { method: 'POST', body: { kind, term, note, ...(kind === 'STOP' ? { category, weight: Number(weight) } : {}) } }), 'Добавлено');
    if (done) {
      setTerm('');
      setNote('');
    }
  };
  return (
    <section style={css.card} aria-label="Добавить" data-testid="safety-add">
      <h2 style={{ ...css.h2, marginTop: 0 }}>Добавить</h2>
      <Notice error={error} ok={ok} />
      <div style={{ ...css.row, alignItems: 'flex-end' }}>
        <Field label="Что">
          <select style={css.input} value={kind} onChange={(e) => setKind(e.target.value as 'STOP' | 'DOMAIN')} data-testid="safety-kind">
            <option value="STOP">Стоп-слово или фраза</option>
            <option value="DOMAIN">Запрещённый сайт</option>
          </select>
        </Field>
        <Field label={kind === 'STOP' ? 'Слово без окончания (например «гарантирован доход»)' : 'Сайт (например plohoi-sait.example)'}>
          <input style={{ ...css.input, minWidth: 260 }} value={term} onChange={(e) => setTerm(e.target.value)} maxLength={120} data-testid="safety-term" />
        </Field>
        {kind === 'STOP' ? (
          <>
            <Field label="Категория">
              <select style={css.input} value={category} onChange={(e) => setCategory(e.target.value as 'A' | 'B')}>
                <option value="A">A — блокировка аккаунта</option>
                <option value="B">B — снятие с публикации</option>
              </select>
            </Field>
            <Field label="Вес (1–100)">
              <input style={{ ...css.input, width: 80 }} inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} />
            </Field>
          </>
        ) : null}
        <Field label="Заметка (видна только вам)">
          <input style={css.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
        <button type="button" style={css.btn} disabled={busy || term.trim().length < 2} onClick={() => void add()} data-testid="safety-submit">Добавить</button>
      </div>
      {kind === 'STOP' ? (
        <p style={css.muted}>
          Пишите основу слова: «парол» найдёт «пароль», «пароля», «паролем»; «зелен единорог» — «зелёных единорогов». Регистр, «ё» и «е», латинские буквы, похожие на русские, пробелы и знаки между буквами не мешают.
          Вес от {BLOCK_FROM} останавливает публикацию, пока автор не уберёт слово; меньший — отправляет сборку модератору.
        </p>
      ) : (
        <p style={css.muted}>Достаточно названия сайта: ссылки на него и на его поддомены будут отклоняться при публикации.</p>
      )}
    </section>
  );
}

/** TS-04, TS-05 · словари проверки сборок: стоп-слова с весами и запрещённые сайты. Правит только администратор, всё в журнале. */
export default function SafetyPage() {
  const { data, error, reload } = useLoad(() => api<{ terms: Term[] }>('/admin/safety-terms'));
  const stop = data?.terms.filter((t) => t.kind === 'STOP') ?? [];
  const domains = data?.terms.filter((t) => t.kind === 'DOMAIN') ?? [];
  return (
    <main style={css.page}>
      <h1 style={css.h1}>Словари проверки</h1>
      <p style={css.muted}>Слова из «пароль», «код из СМС», названия банков и госорганов проверяются всегда и здесь не правятся. Здесь — стоп-слова категорий A и B и запрещённые сайты.</p>
      {error ? <p role="alert" style={css.error}>{error}</p> : null}
      <AddForm onDone={reload} />
      <h2 style={css.h2}>Стоп-слова</h2>
      {data && stop.length === 0 ? <p style={css.muted}>Стоп-слов нет.</p> : null}
      {stop.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={css.table}>
            <thead><tr><th style={css.th}>Слово</th><th style={css.th}>Категория</th><th style={css.th}>Вес</th><th style={css.th}>Состояние</th><th style={css.th}>Действия</th></tr></thead>
            <tbody>{stop.map((t) => <TermRow key={t.id} t={t} onDone={reload} />)}</tbody>
          </table>
        </div>
      ) : null}
      <h2 style={css.h2}>Запрещённые сайты</h2>
      {data && domains.length === 0 ? <p style={css.muted}>Запрещённых сайтов нет.</p> : null}
      {domains.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={css.table}>
            <thead><tr><th style={css.th}>Сайт</th><th style={css.th}>Состояние</th><th style={css.th}>Действия</th></tr></thead>
            <tbody>{domains.map((t) => <TermRow key={t.id} t={t} onDone={reload} />)}</tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
