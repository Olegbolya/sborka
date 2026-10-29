'use client';
import { type ProjectDocument } from '@blokum/schema';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorText, isApiError, upload } from '../../lib/api-browser';
import { type MediaItem, mediaUrl } from '../../lib/editor/media';
import { OCCASIONS, type Occasion, applyPhoto, applyTexts, editableTexts, fillScratch } from '../../lib/wizard/wizard';
import './wizard.css';

interface TemplateItem {
  id: string;
  name: string;
  category: string | null;
}
interface Project {
  id: string;
  title: string;
  document: ProjectDocument;
}
interface AccessPoint {
  id: string;
  url: string;
  active: boolean;
}

const STEPS = ['Повод', 'Основа', 'Содержимое', 'Публикация', 'Поделиться'] as const;

/**
 * P10.2 · «Повод → с нуля или из шаблона → поменять текст и фото → опубликовать → поделиться». The project is made when the base
 * is chosen and dropped again if the creator goes back and chooses another, so no stray drafts are left. With an empty gallery of
 * templates the second step simply offers «С нуля».
 */
export function Wizard() {
  const [step, setStep] = useState(0);
  const [occasion, setOccasion] = useState<Occasion | null>(null);
  const [templates, setTemplates] = useState<TemplateItem[] | null>(null);
  const [fromTemplate, setFromTemplate] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [heading, setHeading] = useState('');
  const [text, setText] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<MediaItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<AccessPoint[]>([]);
  const [copied, setCopied] = useState(false);
  const heading1 = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    api<{ templates: TemplateItem[] }>('/templates')
      .then((r) => setTemplates(r.templates))
      .catch(() => setTemplates([]));
  }, []);
  useEffect(() => heading1.current?.focus(), [step]);

  const shown = useMemo(() => {
    const all = templates ?? [];
    const narrowed = occasion?.category ? all.filter((t) => t.category === occasion.category) : all;
    return narrowed.length > 0 ? narrowed : all;
  }, [templates, occasion]);

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!project) return;
    const id = project.id;
    setProject(null);
    setPhoto(null);
    await api(`/projects/${id}`, { method: 'DELETE' }).catch(() => undefined);
  };

  const chooseOccasion = (o: Occasion) => {
    setOccasion(o);
    setName(o.title);
    setHeading(o.heading);
    setText(o.text);
    setStep(1);
  };

  const chooseBase = (templateId?: string) =>
    run(async () => {
      await discard();
      const made = await api<Project>('/projects', { method: 'POST', body: { title: occasion?.title ?? 'Новая сборка', ...(templateId ? { templateId } : {}) } });
      setProject(made);
      setFromTemplate(templateId !== undefined);
      if (templateId) {
        setName(made.title);
        setValues(Object.fromEntries(editableTexts(made.document).map((t) => [t.id, t.value])));
      }
      setStep(2);
    });

  const sendPhoto = (file: File) =>
    run(async () => {
      const form = new FormData();
      form.append('file', file);
      setPhoto(await upload<MediaItem>('/media', form));
    });

  const saveContent = () =>
    run(async () => {
      if (!project) return;
      const title = name.trim() || occasion?.title || 'Новая сборка';
      let doc: ProjectDocument = fromTemplate ? applyTexts(project.document, values) : fillScratch(project.document, { heading, text, ...(photo ? { mediaId: photo.id } : {}) });
      if (fromTemplate && photo) doc = applyPhoto(doc, photo.id);
      doc = { ...doc, meta: { ...doc.meta, title } };
      await api(`/projects/${project.id}/draft`, { method: 'PUT', headers: { 'If-Match': '*' }, body: { document: doc } });
      setProject({ ...project, title, document: doc });
      setStep(3);
    });

  const publish = () =>
    run(async () => {
      if (!project) return;
      try {
        await api(`/projects/${project.id}/publish`, { method: 'POST', body: {} });
      } catch (e) {
        if (isApiError(e) && e.issues?.length) throw new Error(`${e.message} ${e.issues.map((i) => i.message).join(' ')}`, { cause: e });
        throw e;
      }
      setPoints(await api<AccessPoint[]>(`/projects/${project.id}/access-points`));
      setStep(4);
    });

  const point = points.find((p) => p.active) ?? points[0];
  const copy = async () => {
    if (!point) return;
    try {
      await navigator.clipboard.writeText(point.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const back = () => {
    setError(null);
    if (step === 2) void discard();
    setStep(step - 1);
  };

  return (
    <main className="wz">
      <p className="wz-nav">
        <a href="/cabinet/projects">← Мои сборки</a>
      </p>
      <ol className="wz-steps" aria-label="Шаги">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? 'step' : undefined} className={i < step ? 'done' : i === step ? 'now' : ''}>
            <span>{i + 1}</span> {label}
          </li>
        ))}
      </ol>
      {error && (
        <p className="wz-error" role="alert">
          {error}
        </p>
      )}

      {step === 0 && (
        <section>
          <h1 ref={heading1} tabIndex={-1}>
            Что собираем?
          </h1>
          <p className="wz-lead">Выберите повод — мы подскажем текст и название. Всё можно поменять.</p>
          <ul className="wz-cards">
            {OCCASIONS.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => chooseOccasion(o)}>
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 1 && occasion && (
        <section>
          <h1 ref={heading1} tabIndex={-1}>
            С чего начнём?
          </h1>
          <ul className="wz-cards">
            <li>
              <button type="button" disabled={busy} onClick={() => void chooseBase()}>
                С нуля
                <small>Пустой экран с заголовком и текстом</small>
              </button>
            </li>
            {shown.map((t) => (
              <li key={t.id}>
                <button type="button" disabled={busy} onClick={() => void chooseBase(t.id)}>
                  {t.name}
                  <small>{t.category ?? 'Шаблон'}</small>
                </button>
              </li>
            ))}
          </ul>
          {templates !== null && templates.length === 0 && <p className="wz-hint">Готовых шаблонов пока нет — соберём с нуля.</p>}
          <p>
            <button type="button" className="wz-link" onClick={back}>
              ← Другой повод
            </button>
          </p>
        </section>
      )}

      {step === 2 && project && (
        <section>
          <h1 ref={heading1} tabIndex={-1}>
            Ваш текст и фото
          </h1>
          <label className="wz-field">
            <span>Название сборки</span>
            <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </label>
          {fromTemplate ? (
            editableTexts(project.document).length === 0 ? (
              <p className="wz-hint">В этом шаблоне нет текстов для замены — их можно поменять в редакторе.</p>
            ) : (
              editableTexts(project.document).map((t) => (
                <label key={t.id} className="wz-field">
                  <span>{t.name}</span>
                  <textarea rows={2} value={values[t.id] ?? ''} onChange={(e) => setValues({ ...values, [t.id]: e.target.value })} />
                </label>
              ))
            )
          ) : (
            <>
              <label className="wz-field">
                <span>Заголовок</span>
                <input value={heading} maxLength={120} onChange={(e) => setHeading(e.target.value)} />
              </label>
              <label className="wz-field">
                <span>Текст</span>
                <textarea rows={3} value={text} maxLength={600} onChange={(e) => setText(e.target.value)} />
              </label>
            </>
          )}
          <div className="wz-field">
            <span>Фото (по желанию)</span>
            <label className="wz-btn wz-btn-ghost">
              {busy && !photo ? 'Загружаем…' : photo ? 'Выбрать другое фото' : 'Выбрать фото'}
              <input
                type="file"
                aria-label="Фото"
                accept="image/*"
                className="wz-file"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void sendPhoto(f);
                }}
              />
            </label>
            {photo && <img className="wz-photo" src={mediaUrl(photo.id)} alt="Выбранное фото" />}
          </div>
          <p className="wz-actions">
            <button type="button" className="wz-btn wz-btn-ghost" onClick={back} disabled={busy}>
              Назад
            </button>
            <button type="button" className="wz-btn" onClick={() => void saveContent()} disabled={busy}>
              {busy ? 'Сохраняем…' : 'Дальше'}
            </button>
          </p>
        </section>
      )}

      {step === 3 && project && (
        <section>
          <h1 ref={heading1} tabIndex={-1}>
            Публикуем «{project.title}»
          </h1>
          <p className="wz-lead">После публикации у сборки появится ссылка и QR-код. Править её можно и дальше — в редакторе.</p>
          <p className="wz-actions">
            <button type="button" className="wz-btn wz-btn-ghost" onClick={() => setStep(2)} disabled={busy}>
              Назад
            </button>
            <button type="button" className="wz-btn" onClick={() => void publish()} disabled={busy}>
              {busy ? 'Публикуем…' : 'Опубликовать'}
            </button>
          </p>
        </section>
      )}

      {step === 4 && project && (
        <section>
          <h1 ref={heading1} tabIndex={-1}>
            Готово! Поделитесь ссылкой
          </h1>
          {point ? (
            <>
              <p className="wz-link-box" data-testid="wizard-link">
                {point.url}
              </p>
              <p className="wz-actions">
                <button type="button" className="wz-btn" onClick={() => void copy()}>
                  {copied ? 'Скопировано' : 'Скопировать ссылку'}
                </button>
                <a className="wz-btn wz-btn-ghost" href={point.url} target="_blank" rel="noreferrer">
                  Открыть сборку
                </a>
              </p>
              <img className="wz-qr" src={`/api/v1/projects/${project.id}/access-points/${point.id}/qr.svg`} alt="QR-код со ссылкой на сборку" width={220} height={220} />
            </>
          ) : (
            <p className="wz-hint">Ссылку и QR-код можно взять в кабинете.</p>
          )}
          <p className="wz-actions">
            <a className="wz-btn wz-btn-ghost" href={`/app/projects/${project.id}/edit`}>
              Открыть редактор
            </a>
            <a className="wz-btn wz-btn-ghost" href="/cabinet/projects">
              В кабинет
            </a>
          </p>
        </section>
      )}
    </main>
  );
}
