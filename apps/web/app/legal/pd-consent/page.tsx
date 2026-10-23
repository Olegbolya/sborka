import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const LEGAL_DIR = resolve(process.cwd(), 'legal');

const s = {
  main: { minHeight: '100dvh', padding: '48px 16px', maxWidth: 720, margin: '0 auto' },
  heading: { fontSize: 'clamp(20px, 4vw, 28px)', lineHeight: 1.2, margin: '0 0 24px', letterSpacing: '-0.02em' },
  draft: {
    display: 'inline-block',
    padding: '4px 10px',
    background: '#f5a623',
    color: '#fff',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 24,
  },
  body: { fontSize: 15, lineHeight: 1.7, color: 'var(--muted)', whiteSpace: 'pre-wrap' as const },
};

export default function PdConsentPage() {
  const filePath = resolve(LEGAL_DIR, 'pd-consent.md');
  const bodyMd = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';

  return (
    <main style={s.main}>
      <span style={s.draft}>Черновик</span>
      <h1 style={s.heading}>Согласие на обработку персональных данных</h1>
      <div style={s.body}>{bodyMd}</div>
    </main>
  );
}
