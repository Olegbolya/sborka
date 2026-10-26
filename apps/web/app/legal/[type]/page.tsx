import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { notFound } from 'next/navigation';

const LEGAL_DIR = resolve(process.cwd(), 'legal');

const TYPE_TO_FILE: Record<string, { file: string; title: string }> = {
  terms: { file: 'terms.md', title: 'Пользовательское соглашение' },
  offer: { file: 'offer.md', title: 'Оферта на оказание услуг' },
  privacy: { file: 'privacy.md', title: 'Политика обработки персональных данных' },
  'pd-consent': { file: 'pd-consent.md', title: 'Согласие на обработку персональных данных' },
  dpa: { file: 'dpa.md', title: 'Условия поручения обработки персональных данных' },
  'content-rules': { file: 'content-rules.md', title: 'Правила допустимого контента' },
  cookies: { file: 'cookies.md', title: 'Политика использования файлов cookie' },
  marketing: { file: 'marketing.md', title: 'Согласие на получение рекламных сообщений' },
  complaints: { file: 'complaints.md', title: 'Порядок рассмотрения жалоб и заявлений правообладателей' },
  contacts: { file: 'contacts.md', title: 'Контакты и реквизиты' },
  'participant-notice': { file: 'participant-notice.md', title: 'Уведомление участника' },
};

const s = {
  main: { minHeight: '100dvh', padding: '48px 16px', maxWidth: 720, margin: '0 auto' },
  nav: { marginBottom: 32 },
  back: { fontSize: 14, color: 'var(--muted)', textDecoration: 'none' },
  draft: {
    display: 'inline-block',
    padding: '4px 10px',
    background: '#f5a623',
    color: '#fff',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 16,
  },
  heading: { fontSize: 'clamp(18px, 3.5vw, 26px)', lineHeight: 1.2, margin: '0 0 24px', letterSpacing: '-0.02em' },
  body: { fontSize: 15, lineHeight: 1.75, color: 'var(--muted)', whiteSpace: 'pre-wrap' as const },
};

export default async function LegalDocumentPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const entry = TYPE_TO_FILE[type];
  if (!entry) notFound();

  const filePath = resolve(LEGAL_DIR, entry.file);
  const bodyMd = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';

  const isDraft = bodyMd.includes('ЧЕРНОВИК');

  return (
    <main style={s.main}>
      <nav style={s.nav}>
        <a href="/" style={s.back}>← Главная</a>
      </nav>
      {isDraft && <span style={s.draft}>Черновик — на проверке у юриста</span>}
      <h1 style={s.heading}>{entry.title}</h1>
      <div style={s.body}>{bodyMd}</div>
    </main>
  );
}

export function generateStaticParams() {
  return Object.keys(TYPE_TO_FILE).map((type) => ({ type }));
}
