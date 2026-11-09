'use client';
import { useState } from 'react';
import { api } from '../../../lib/api-browser';
import { Badge, Field, Notice, css, useAction, useLoad } from '../../../components/admin/ui';
import { dateTime } from '../../../lib/admin/format';

interface Promo {
  id: string;
  code: string;
  kind: 'PERCENT' | 'FIXED' | 'FREE_PASS';
  value: number;
  appliesTo: string[];
  maxActivations: number | null;
  activations: number;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  note: string;
}

const KIND_LABEL: Record<Promo['kind'], string> = { PERCENT: 'Скидка в процентах', FIXED: 'Скидка в рублях', FREE_PASS: 'Бесплатный «Праздник»' };
const APPLIES_LABEL: Record<string, string> = { SUBSCRIPTION: 'подписки', PASS: '«Праздник»', ADDON: 'допродажи' };

const sizeOf = (p: Promo): string => (p.kind === 'PERCENT' ? `−${p.value} %` : p.kind === 'FIXED' ? `−${p.value} ₽` : 'бесплатно');

function PromoRow({ p, onDone }: { p: Promo; onDone: () => void }) {
  const [max, setMax] = useState(p.maxActivations === null ? '' : String(p.maxActivations));
  const { busy, error, ok, run } = useAction(onDone);
  const patch = (body: Record<string, unknown>, done: string) => run(() => api(`/admin/promo-codes/${p.id}`, { method: 'PATCH', body }), done);
  return (
    <article style={css.card} aria-label={`Промокод ${p.code}`} data-testid={`promo-${p.code}`}>
      <div style={css.row}>
        <strong>{p.code}</strong>
        <Badge color={p.active ? '#16a34a' : '#dc2626'}>{p.active ? 'Действует' : 'Выключен'}</Badge>
        <span>{KIND_LABEL[p.kind]}: {sizeOf(p)}</span>
        <span style={css.muted}>
          для: {p.appliesTo.map((k) => APPLIES_LABEL[k] ?? k).join(', ')} · использовано {p.activations}
          {p.maxActivations !== null ? ` из ${p.maxActivations}` : ''}
          {p.validFrom ? ` · с ${dateTime(p.validFrom)}` : ''}
          {p.validTo ? ` · до ${dateTime(p.validTo)}` : ''}
          {p.note ? ` · ${p.note}` : ''}
        </span>
      </div>
      <Notice error={error} ok={ok} />
      <div style={{ ...css.row, alignItems: 'flex-end', marginTop: 8 }}>
        <Field label="Сколько раз можно использовать (пусто — без ограничения)">
          <input style={css.input} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} />
        </Field>
        <button type="button" style={css.btnLight} disabled={busy} onClick={() => void patch({ maxActivations: max.trim() === '' ? null : Number(max) }, 'Лимит сохранён')}>
          Сохранить лимит
        </button>
        {p.active ? (
          <button type="button" style={css.btnDanger} disabled={busy} onClick={() => void patch({ active: false }, 'Выключен')}>Выключить</button>
        ) : (
          <button type="button" style={css.btn} disabled={busy} onClick={() => void patch({ active: true }, 'Включён')}>Включить</button>
        )}
      </div>
    </article>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<Promo['kind']>('PERCENT');
  const [value, setValue] = useState('10');
  const [max, setMax] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [note, setNote] = useState('');
  const [applies, setApplies] = useState<string[]>(['SUBSCRIPTION', 'PASS', 'ADDON']);
  const { busy, error, ok, run } = useAction(onDone);
  const toggle = (k: string) => setApplies((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const create = async () => {
    const done = await run(
      () =>
        api('/admin/promo-codes', {
          method: 'POST',
          body: {
            code,
            kind,
            ...(kind === 'FREE_PASS' ? {} : { value: Number(value) }),
            appliesTo: applies,
            maxActivations: max.trim() === '' ? null : Number(max),
            validFrom: validFrom || null,
            validTo: validTo || null,
            note,
          },
        }),
      'Промокод создан',
    );
    if (done) setCode('');
  };
  return (
    <section style={css.card} aria-label="Новый промокод" data-testid="promo-create">
      <h2 style={{ ...css.h2, marginTop: 0 }}>Новый промокод</h2>
      <Notice error={error} ok={ok} />
      <div style={css.row}>
        <Field label="Код (латинские буквы, цифры, «-», «_»)">
          <input style={css.input} value={code} onChange={(e) => setCode(e.target.value)} maxLength={32} data-testid="promo-new-code" />
        </Field>
        <Field label="Вид">
          <select style={css.input} value={kind} onChange={(e) => setKind(e.target.value as Promo['kind'])} data-testid="promo-new-kind">
            {Object.entries(KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </Field>
        {kind !== 'FREE_PASS' && (
          <Field label={kind === 'PERCENT' ? 'Размер, % (1–99)' : 'Размер, ₽'}>
            <input style={css.input} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} data-testid="promo-new-value" />
          </Field>
        )}
      </div>
      {kind !== 'FREE_PASS' && (
        <fieldset style={{ border: 'none', padding: 0, margin: '10px 0' }}>
          <legend style={css.muted}>К чему подходит</legend>
          {Object.entries(APPLIES_LABEL).map(([k, l]) => (
            <label key={k} style={{ marginRight: 16 }}>
              <input type="checkbox" checked={applies.includes(k)} onChange={() => toggle(k)} /> {l}
            </label>
          ))}
        </fieldset>
      )}
      <div style={css.row}>
        <Field label="Сколько раз можно использовать (пусто — без ограничения)">
          <input style={css.input} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} />
        </Field>
        <Field label="Действует с">
          <input style={css.input} type="datetime-local" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </Field>
        <Field label="Действует до">
          <input style={css.input} type="datetime-local" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
        </Field>
        <Field label="Заметка (видна только вам)">
          <input style={css.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
      </div>
      <p style={css.muted}>Один человек может использовать один код один раз. Вид и размер скидки потом менять нельзя — выключите код и создайте новый.</p>
      <button type="button" style={css.btn} disabled={busy || code.trim() === ''} onClick={() => void create()} data-testid="promo-create-submit">
        Создать
      </button>
    </section>
  );
}

/** AD-05 · промокоды: скидка в процентах или рублях, бесплатный «Праздник», лимит использований и срок. Меняет только администратор, всё идёт в журнал. */
export default function PromoPage() {
  const { data, error, reload } = useLoad(() => api<{ codes: Promo[] }>('/admin/promo-codes'));
  return (
    <main style={css.page}>
      <h1 style={css.h1}>Промокоды</h1>
      {error ? <p role="alert" style={css.error}>{error}</p> : null}
      <CreateForm onDone={reload} />
      <h2 style={css.h2}>Созданные</h2>
      {data && data.codes.length === 0 ? <p style={css.muted}>Промокодов пока нет.</p> : null}
      {data?.codes.map((p) => <PromoRow key={p.id} p={p} onDone={reload} />)}
    </main>
  );
}
