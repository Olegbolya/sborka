import { NextResponse, type NextRequest } from 'next/server';
import { REQUEST_ID_HEADER, newRequestId, normalizeRequestId } from '@blokum/observability';

/**
 * Every page request gets an id (or keeps a safe incoming one). The id is passed to server code
 * (and from there to the API via `apiFetch`) and returned to the browser for support requests.
 */
export function proxy(request: NextRequest): NextResponse {
  const id = normalizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? newRequestId();
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, id);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, id);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
