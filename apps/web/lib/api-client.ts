import { REQUEST_ID_HEADER } from '@blokum/observability';

/** Address of the API for server-side calls (same machine, docs/02-ARCHITECTURE.md §3). */
export const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? 3100}`;

/**
 * Server-side call to the API that keeps the request id of the incoming page request,
 * so web, API and worker logs of one user action share the same id.
 */
export async function apiFetch(path: string, init: RequestInit & { requestId?: string | null } = {}): Promise<Response> {
  const { requestId, headers, ...rest } = init;
  const h = new Headers(headers);
  if (requestId) h.set(REQUEST_ID_HEADER, requestId);
  if (!h.has('accept')) h.set('accept', 'application/json');
  const url = new URL(path.startsWith('/') ? path : `/${path}`, API_INTERNAL_URL);
  return fetch(url, { ...rest, headers: h, cache: 'no-store' });
}
