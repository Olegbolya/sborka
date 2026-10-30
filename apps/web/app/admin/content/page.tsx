'use client';
import { useState } from 'react';
import { api } from '../../../lib/api-browser';
import { Field, Notice, css, useAction, useLoad } from '../../../components/admin/ui';
import { dateTime } from '../../../lib/admin/format';

interface Template {
  id: string;
  name: string;
  category: string | null;
  sort: number;
  sourceProjectId: string | null;
  publishedAt: string | null;
}

interface Theme {
  id: string;
  name: string;
  publishedAt: string | null;
}

/** AD-11 · system templates and themes: published from any project or theme, with a category and an order; taken down here. */
export default function ContentPage() {
  const templates = useLoad(() => api<Template[]>('/admin/templates'));
  const themes = useLoad(() => api<Theme[]>('/admin/themes'));
  const [tpl, setTpl] = useState({ projectId: '', name: '', category: '', sort: '0' });
  const [theme, setTheme] = useState({ source: 'themeId' as 'themeId' | 'projectId', id: '', name: '' });
  const tplAction = useAction(templates.reload);
  const themeAction = useAction(themes.reload);
  const [summary, setSummary] = useState('');
  const starter = useAction(() => {
    templates.reload();
    themes.reload();
  });

  return (
    <main style={css.page}>
      <h1 style={css.h1}>Стартовый набор</h1>
      <Notice error={starter.error} ok={starter.ok ? summary : ''} />
      <div style={css.card}>
        <p style={{ marginTop: 0 }}>Три темы («Новогодний уют», «Светлая нейтральная», «Тёмная нейтральная») и четырнадцать шаблонов: «Письмо Деду Морозу», «Викторина с баллами», «Анонимный опрос», «Приглашение с ответом» и десять игр. То, что уже есть под тем же названием, не трогается — повторное нажатие ничего не добавит.</p>
        <button
          type="button"
          style={css.btn}
          disabled={starter.busy}
          onClick={() =>
            void starter.run(async () => {
              const r = await api<{ themes: { added: number; skipped: number }; templates: { added: number; skipped: number } }>('/admin/starter-set', { method: 'POST' });
              setSummary(`Добавлено тем: ${r.themes.added}, шаблонов: ${r.templates.added}. Уже были и остались как есть: тем ${r.themes.skipped}, шаблонов ${r.templates.skipped}.`);
            }, 'Готово')
          }
        >
          Опубликовать стартовый набор
        </button>
      </div>
      <h1 style={{ ...css.h1, marginTop: 36 }}>Системные шаблоны</h1>
      <Notice error={tplAction.error || templates.error} ok={tplAction.ok} />
      {templates.data?.length === 0 ? <p style={css.muted}>Системных шаблонов нет — галерея у создателей пуста.</p> : null}
      {templates.data?.map((t) => (
        <div key={t.id} style={css.card} data-testid="system-template">
          <div style={css.row}>
            <strong>{t.name}</strong>
            <span style={css.muted}>{t.category ?? 'без категории'} · порядок {t.sort} · {dateTime(t.publishedAt)}</span>
            <button type="button" style={{ ...css.btnLight, marginLeft: 'auto' }} disabled={tplAction.busy} onClick={() => void tplAction.run(() => api(`/admin/templates/${t.id}`, { method: 'DELETE' }), `Шаблон «${t.name}» снят`)}>Снять</button>
          </div>
        </div>
      ))}
      <form
        aria-label="Опубликовать шаблон"
        style={css.card}
        onSubmit={(e) => {
          e.preventDefault();
          void tplAction.run(() => api('/admin/templates', { method: 'POST', body: { projectId: tpl.projectId, name: tpl.name || undefined, category: tpl.category || undefined, sort: Number(tpl.sort) } }), 'Шаблон опубликован').then((done) => done && setTpl({ projectId: '', name: '', category: '', sort: '0' }));
        }}
      >
        <strong>Опубликовать сборку как системный шаблон</strong>
        <div style={{ ...css.row, marginTop: 8 }}>
          <Field label="Идентификатор сборки (виден в профиле автора)"><input style={css.input} value={tpl.projectId} onChange={(e) => setTpl({ ...tpl, projectId: e.target.value })} required /></Field>
          <Field label="Название (по умолчанию — название сборки)"><input style={css.input} value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} /></Field>
        </div>
        <div style={css.row}>
          <Field label="Категория"><input style={css.input} value={tpl.category} onChange={(e) => setTpl({ ...tpl, category: e.target.value })} /></Field>
          <Field label="Порядок"><input style={css.input} type="number" value={tpl.sort} onChange={(e) => setTpl({ ...tpl, sort: e.target.value })} /></Field>
        </div>
        <p><button type="submit" style={css.btn} disabled={tplAction.busy}>Опубликовать</button></p>
      </form>

      <h1 style={{ ...css.h1, marginTop: 36 }}>Системные темы</h1>
      <Notice error={themeAction.error || themes.error} ok={themeAction.ok} />
      {themes.data?.length === 0 ? <p style={css.muted}>Системных тем нет — продукт работает и без них.</p> : null}
      {themes.data?.map((t) => (
        <div key={t.id} style={css.card} data-testid="system-theme">
          <div style={css.row}>
            <strong>{t.name}</strong>
            <span style={css.muted}>{dateTime(t.publishedAt)}</span>
            <button type="button" style={{ ...css.btnLight, marginLeft: 'auto' }} disabled={themeAction.busy} onClick={() => void themeAction.run(() => api(`/admin/themes/${t.id}`, { method: 'DELETE' }), `Тема «${t.name}» снята`)}>Снять</button>
          </div>
        </div>
      ))}
      <form
        aria-label="Опубликовать тему"
        style={css.card}
        onSubmit={(e) => {
          e.preventDefault();
          void themeAction.run(() => api('/admin/themes', { method: 'POST', body: { [theme.source]: theme.id, name: theme.name || undefined } }), 'Тема опубликована как системная').then((done) => done && setTheme({ ...theme, id: '', name: '' }));
        }}
      >
        <strong>Сделать тему системной</strong>
        <div style={{ ...css.row, marginTop: 8 }}>
          <Field label="Откуда взять">
            <select style={css.input} value={theme.source} onChange={(e) => setTheme({ ...theme, source: e.target.value as 'themeId' | 'projectId' })}>
              <option value="themeId">Из темы создателя</option>
              <option value="projectId">Из темы внутри сборки</option>
            </select>
          </Field>
          <Field label="Идентификатор"><input style={css.input} value={theme.id} onChange={(e) => setTheme({ ...theme, id: e.target.value })} required /></Field>
          <Field label="Название (необязательно)"><input style={css.input} value={theme.name} onChange={(e) => setTheme({ ...theme, name: e.target.value })} /></Field>
        </div>
        <p><button type="submit" style={css.btn} disabled={themeAction.busy}>Опубликовать</button></p>
      </form>
    </main>
  );
}
