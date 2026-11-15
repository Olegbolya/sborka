import { LegalMarkdown } from '../../../components/legal/LegalMarkdown';
import { readLegalFile } from '../../../lib/legal-files';

const s = {
  main: { minHeight: '100dvh', padding: '48px 16px', maxWidth: 720, margin: '0 auto' },
  heading: { fontSize: 'clamp(20px, 4vw, 28px)', lineHeight: 1.2, margin: '0 0 24px', letterSpacing: '-0.02em' },
};

export default function PdConsentPage() {
  const bodyMd = readLegalFile('pd-consent.md');

  return (
    <main style={s.main}>
      <h1 style={s.heading}>Согласие на обработку персональных данных</h1>
      <LegalMarkdown source={bodyMd} />
    </main>
  );
}
