import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { LegalMarkdown } from '../../../../components/legal/LegalMarkdown';
import { apiFetch } from '../../../../lib/api-client';

/**
 * PL-23 · B-20 · ADR-131 · the consent the participant gives in a project: the template of the service with the creator's details
 * (the operator), the purpose, the term and the personal data this project asks for. The checkbox in the player links here.
 */
export const dynamic = 'force-dynamic';

const s = {
  main: { minHeight: '100dvh', padding: '48px 16px', maxWidth: 720, margin: '0 auto' },
  heading: { fontSize: 'clamp(18px, 3.5vw, 26px)', lineHeight: 1.2, margin: '0 0 8px', letterSpacing: '-0.02em' },
  version: { fontSize: 13, color: 'var(--muted)', margin: '0 0 24px' },
};

export default async function ParticipantConsentPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(projectId)) notFound();
  const h = await headers();
  const res = await apiFetch(`/api/v1/play/${encodeURIComponent(projectId)}/consent`, { requestId: h.get('x-request-id') });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`Не удалось открыть текст согласия (${res.status})`);
  const doc = (await res.json()) as { title: string; version: number; markdown: string };
  return (
    <main style={s.main} data-testid="participant-consent">
      <h1 style={s.heading}>{doc.title}</h1>
      <p style={s.version}>Редакция шаблона {doc.version}</p>
      <LegalMarkdown source={doc.markdown} />
    </main>
  );
}
