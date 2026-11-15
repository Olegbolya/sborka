'use client';
import { type CSSProperties, type FormEvent, type ReactNode, useState } from 'react';
import { DATA_REQUEST_KINDS, REPORT_CATEGORIES } from '@blokum/schema';
import { api, errorText } from '../../lib/api-browser';

const s: Record<string, CSSProperties> = {
  main: { minHeight: '100dvh', padding: '48px 16px', maxWidth: 720, margin: '0 auto' },
  back: { fontSize: 14, color: 'var(--muted)', textDecoration: 'none' },
  heading: { fontSize: 'clamp(20px, 3.5vw, 28px)', lineHeight: 1.2, margin: '24px 0 12px', letterSpacing: '-0.02em' },
  lead: { fontSize: 15, lineHeight: 1.6, color: 'var(--muted)', margin: '0 0 24px' },
  label: { display: 'block', fontSize: 14, fontWeight: 600, margin: '16px 0 6px' },
  hint: { display: 'block', fontSize: 13, fontWeight: 400, color: 'var(--muted)', marginTop: 2 },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 16, borderRadius: 10, border: '1px solid color-mix(in srgb, var(--fg) 25%, transparent)', background: 'var(--bg)', color: 'inherit', fontFamily: 'inherit' },
  check: { display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.5, margin: '12px 0' },
  btn: { marginTop: 20, padding: '12px 20px', minHeight: 44, fontSize: 16, fontWeight: 600, borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' },
  error: { margin: '16px 0', padding: '10px 12px', borderRadius: 10, background: '#fde8e8', color: '#9b1c1c', fontSize: 14 },
  ok: { margin: '16px 0', padding: '14px 16px', borderRadius: 10, background: '#e6f4ea', color: '#17603a', fontSize: 15, lineHeight: 1.6 },
  radio: { display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 15 },
};

const day = (iso: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date(iso));

function Shell({ title, lead, children }: { title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <main style={s.main}>
      <a href="/" style={s.back}>← Главная</a>
      <h1 style={s.heading}>{title}</h1>
      <p style={s.lead}>{lead}</p>
      {children}
    </main>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label style={s.label}>
      {label}
      {hint ? <span style={s.hint}>{hint}</span> : null}
      <span style={{ display: 'block', marginTop: 6 }}>{children}</span>
    </label>
  );
}

/** P8.4 · 149-ФЗ ст. 15.7 ч. 2: every field the law asks of a copyright holder's notice. */
export function CopyrightForm() {
  const [kind, setKind] = useState<'PERSON' | 'ORG'>('PERSON');
  const [f, setF] = useState({ name: '', document: '', address: '', email: '', phone: '', representative: '', objectDescription: '', urls: '' });
  const [checks, setChecks] = useState({ hasRights: false, noPermission: false, pdConsent: false });
  const [poa, setPoa] = useState<{ name: string; data: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ id: string; dueAt: string } | null>(null);
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [key]: e.target.value }));

  /** Доверенность: PDF, JPG или PNG до 2 МБ — читаем файл в base64 прямо в браузере. */
  const pickPoa = (file: File | undefined) => {
    setPoa(null);
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Файл доверенности — не больше 2 МБ.');
      return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      setPoa({ name: file.name, data: url.slice(url.indexOf(',') + 1) });
    };
    reader.onerror = () => setError('Не удалось прочитать файл доверенности.');
    reader.readAsDataURL(file);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (f.representative.trim() !== '' && !poa) {
      setError('Приложите файл доверенности (PDF, JPG или PNG, до 2 МБ).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const urls = f.urls.split(/\s+/).filter((u) => u !== '');
      setDone(await api<{ id: string; dueAt: string }>('/legal/requests/copyright', { method: 'POST', body: { claimantKind: kind, ...f, urls, ...checks, ...(f.representative.trim() !== '' && poa ? { powerOfAttorney: { data: poa.data } } : {}) } }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Shell title="Заявление принято" lead="">
        <p style={s.ok} role="status">
          Номер заявления: <strong>{done.id}</strong>. Мы рассмотрим его до {day(done.dueAt)} (по московскому времени) и ответим на указанную почту. Если понадобится уточнение, напишем один раз.
        </p>
      </Shell>
    );
  }
  return (
    <Shell
      title="Заявление правообладателя"
      lead={
        <>
          Если в сборке на «Блоккере» без разрешения размещён ваш материал — текст, фотография, видео, музыка, шрифт, — заполните форму. Мы рассматриваем заявление в течение 24 часов. Порядок описан в{' '}
          <a href="/legal/complaints">правилах рассмотрения жалоб</a>.
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)} noValidate>
        <div style={s.label}>Кто обращается</div>
        <div style={s.radio} role="radiogroup" aria-label="Кто обращается">
          <label><input type="radio" name="kind" checked={kind === 'PERSON'} onChange={() => setKind('PERSON')} /> Человек</label>
          <label><input type="radio" name="kind" checked={kind === 'ORG'} onChange={() => setKind('ORG')} /> Организация</label>
        </div>
        <Field label={kind === 'PERSON' ? 'Фамилия, имя, отчество' : 'Наименование организации'}>
          <input style={s.input} value={f.name} onChange={set('name')} required maxLength={300} autoComplete="name" />
        </Field>
        {kind === 'PERSON' ? (
          <Field label="Паспортные данные" hint="Серия и номер, кем и когда выдан — этого требует закон (ч. 2 ст. 15.7 закона № 149-ФЗ).">
            <input style={s.input} value={f.document} onChange={set('document')} required maxLength={300} autoComplete="off" />
          </Field>
        ) : (
          <Field label="Место нахождения и адрес организации">
            <input style={s.input} value={f.address} onChange={set('address')} required maxLength={500} />
          </Field>
        )}
        <Field label="Электронная почта для ответа">
          <input style={s.input} type="email" inputMode="email" value={f.email} onChange={set('email')} required maxLength={254} autoComplete="email" />
        </Field>
        <Field label="Телефон (необязательно)">
          <input style={s.input} type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} maxLength={40} autoComplete="tel" />
        </Field>
        <Field label="Если вы представитель правообладателя (необязательно)" hint="Чьи интересы представляете и на каком основании: номер и дата доверенности.">
          <input style={s.input} value={f.representative} onChange={set('representative')} maxLength={500} />
        </Field>
        {f.representative.trim() !== '' ? (
          <Field label="Файл доверенности" hint="PDF, JPG или PNG, не больше 2 МБ. Без доверенности заявление представителя не принимается.">
            <input style={s.input} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => pickPoa(e.target.files?.[0])} required />
          </Field>
        ) : null}
        <Field label="Что защищается" hint="Название и описание произведения, где и когда оно было впервые опубликовано.">
          <textarea style={{ ...s.input, minHeight: 110 }} value={f.objectDescription} onChange={set('objectDescription')} required maxLength={4000} />
        </Field>
        <Field label="Ссылки на страницы, где размещён материал" hint="Каждая ссылка с новой строки, начиная с https://">
          <textarea style={{ ...s.input, minHeight: 80 }} value={f.urls} onChange={set('urls')} required inputMode="url" />
        </Field>
        <label style={s.check}>
          <input type="checkbox" checked={checks.hasRights} onChange={(e) => setChecks((c) => ({ ...c, hasRights: e.target.checked }))} />
          <span>Подтверждаю, что права на этот материал принадлежат мне или тому, кого я представляю.</span>
        </label>
        <label style={s.check}>
          <input type="checkbox" checked={checks.noPermission} onChange={(e) => setChecks((c) => ({ ...c, noPermission: e.target.checked }))} />
          <span>Подтверждаю, что разрешения на размещение этого материала не давалось.</span>
        </label>
        <label style={s.check}>
          <input type="checkbox" checked={checks.pdConsent} onChange={(e) => setChecks((c) => ({ ...c, pdConsent: e.target.checked }))} />
          <span>
            Согласен на обработку персональных данных из этого заявления для его рассмотрения (<a href="/legal/privacy">политика обработки</a>).
          </span>
        </label>
        {error ? <p style={s.error} role="alert">{error}</p> : null}
        <button style={s.btn} type="submit" disabled={busy}>{busy ? 'Отправляем…' : 'Отправить заявление'}</button>
      </form>
    </Shell>
  );
}

/** P8.5 · 152-ФЗ ст. 14, 20: a person asks about their data; the answer comes in ten working days. */
export function DataRequestForm() {
  const [kind, setKind] = useState<string>(DATA_REQUEST_KINDS[0].code);
  const [f, setF] = useState({ contact: '', details: '', slug: '' });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ id: string; dueAt: string } | null>(null);
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // A whole link may be pasted: only the address of the project is needed.
      const slug = (/\/s\/([A-Za-z0-9_-]+)/.exec(f.slug)?.[1] ?? f.slug).trim();
      setDone(await api<{ id: string; dueAt: string }>('/legal/requests/data', { method: 'POST', body: { kind, contact: f.contact, details: f.details, slug, consent } }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Shell title="Запрос принят" lead="">
        <p style={s.ok} role="status">
          Номер запроса: <strong>{done.id}</strong>. Ответим не позднее {day(done.dueAt)} — это десять рабочих дней, как требует закон.
        </p>
      </Shell>
    );
  }
  return (
    <Shell
      title="Запрос о персональных данных"
      lead="Здесь можно узнать, какие ваши данные есть в «Блоккере», попросить удалить их или отозвать согласие на обработку. Ответ — в течение десяти рабочих дней."
    >
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Field label="О чём запрос">
          <select style={s.input} value={kind} onChange={(e) => setKind(e.target.value)}>
            {DATA_REQUEST_KINDS.map((k) => (
              <option key={k.code} value={k.code}>{k.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Как с вами связаться" hint="Почта или телефон, которые вы указывали в сборке или при входе, — по ним мы найдём ваши данные.">
          <input style={s.input} value={f.contact} onChange={set('contact')} required maxLength={200} />
        </Field>
        <Field label="Ссылка на сборку (необязательно)" hint="Если данные вы оставляли в чьей-то сборке — вставьте её ссылку.">
          <input style={s.input} value={f.slug} onChange={set('slug')} maxLength={300} inputMode="url" />
        </Field>
        <Field label="Суть запроса">
          <textarea style={{ ...s.input, minHeight: 110 }} value={f.details} onChange={set('details')} required maxLength={4000} />
        </Field>
        <label style={s.check}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            Согласен на обработку указанного контакта, чтобы получить ответ (<a href="/legal/privacy">политика обработки</a>).
          </span>
        </label>
        {error ? <p style={s.error} role="alert">{error}</p> : null}
        <button style={s.btn} type="submit" disabled={busy}>{busy ? 'Отправляем…' : 'Отправить запрос'}</button>
      </form>
    </Shell>
  );
}

/** Из ссылки вида https://blokker.ru/s/<адрес> или просто «адрес» достаёт адрес сборки. */
export const slugFromLink = (raw: string): string => {
  const v = raw.trim();
  const m = /\/s\/([A-Za-z0-9_-]+)/.exec(v);
  if (m) return m[1]!;
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : '';
};

/** P8.4 · жалоба на сборку не из плеера: по ссылке на неё, для тех, кто открыл её не у себя в браузере или не нашёл кнопку. */
export function ComplaintForm({ initialSlug = '' }: { initialSlug?: string }) {
  const [link, setLink] = useState(initialSlug);
  const [category, setCategory] = useState('');
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const slug = slugFromLink(link);
    if (!slug) {
      setError('Вставьте ссылку на сборку — она выглядит как https://blokker.ru/s/…');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/reports', { method: 'POST', body: { slug, category, text, ...(contact.trim() ? { contact, consent } : {}) } });
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Shell title="Жалоба принята" lead="">
        <p style={s.ok} role="status">
          Спасибо. Модераторы посмотрят сборку в сроки, которые указаны в <a href="/legal/complaints">правилах рассмотрения жалоб</a>. Если вы оставили контакт, мы ответим на него.
        </p>
      </Shell>
    );
  }
  return (
    <Shell
      title="Пожаловаться на сборку"
      lead={
        <>
          Опишите, что не так. Если нарушены ваши авторские права, используйте <a href="/legal/copyright">заявление правообладателя</a> — по нему мы отвечаем в течение 24 часов.
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Ссылка на сборку" hint="Адрес из строки браузера, например https://blokker.ru/s/abc123">
          <input style={s.input} value={link} onChange={(e) => setLink(e.target.value)} required maxLength={300} inputMode="url" autoComplete="off" />
        </Field>
        <Field label="Что не так">
          <select style={s.input} value={category} onChange={(e) => setCategory(e.target.value)} required>
            <option value="">Выберите из списка</option>
            {REPORT_CATEGORIES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Подробности" hint="Где именно в сборке и что вы увидели.">
          <textarea style={{ ...s.input, minHeight: 110 }} value={text} onChange={(e) => setText(e.target.value)} required maxLength={4000} />
        </Field>
        <Field label="Как с вами связаться (необязательно)" hint="Почта или телефон — только если хотите получить ответ.">
          <input style={s.input} value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} autoComplete="email" />
        </Field>
        {contact.trim() !== '' ? (
          <label style={s.check}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              Согласен на обработку этого контакта, чтобы получить ответ (<a href="/legal/privacy">политика обработки</a>).
            </span>
          </label>
        ) : null}
        {error ? <p style={s.error} role="alert">{error}</p> : null}
        <button style={s.btn} type="submit" disabled={busy}>{busy ? 'Отправляем…' : 'Отправить жалобу'}</button>
      </form>
    </Shell>
  );
}
