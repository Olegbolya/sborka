import { headers } from 'next/headers';
import { apiFetch } from '../api-client';
import { type PlayView } from './api';

/** The state of a project for the participant, read on the server: `null` — «Недоступно». */
export async function loadPlayView(slug: string): Promise<PlayView | null> {
  const h = await headers();
  const res = await apiFetch(`/api/v1/play/${encodeURIComponent(slug)}`, { requestId: h.get('x-request-id') });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Не удалось открыть сборку (${res.status})`);
  return (await res.json()) as PlayView;
}

/** The address of the site as the participant sees it (for the absolute addresses of link previews). */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'blokum.ru';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** AD-07 · whether the transitions to other sites are on now; if the API does not answer, they stay on (the switch is an emergency measure, not a dependency). */
export async function externalLinksEnabled(): Promise<boolean> {
  try {
    const h = await headers();
    const res = await apiFetch('/api/v1/flags/public', { requestId: h.get('x-request-id') });
    if (!res.ok) return true;
    return ((await res.json()) as { externalLinks?: boolean }).externalLinks !== false;
  } catch {
    return true;
  }
}
