import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { apiFetch } from '../../../lib/api-client';

export const metadata = { title: 'Блокум', robots: { index: false, follow: false } };

/** PL-02 · the address of a QR code: counts the scan and goes to the project with the access point as the source. */
export default async function ScanPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const h = await headers();
  const res = await apiFetch(`/api/v1/play/scan/${encodeURIComponent(code)}`, { requestId: h.get('x-request-id') });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`Не удалось открыть ссылку (${res.status})`);
  const { slug, source } = (await res.json()) as { slug: string; source: string };
  redirect(`/s/${encodeURIComponent(slug)}?p=${encodeURIComponent(source)}`);
}
