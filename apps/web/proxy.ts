import { NextResponse, type NextRequest } from 'next/server';
import { REQUEST_ID_HEADER, newRequestId, normalizeRequestId } from '@blokum/observability';
import { analyticsAllowed, metrikaId } from './lib/analytics';
import { newNonce, securityHeaders } from './lib/security-headers';

/**
 * Every page request gets an id (or keeps a safe incoming one). The id is passed to server code
 * (and from there to the API via `apiFetch`) and returned to the browser for support requests.
 */
export function proxy(request: NextRequest): NextResponse {
  const id = normalizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? newRequestId();
  const nonce = newNonce();
  const security = securityHeaders(request.nextUrl.pathname, { nonce, analytics: metrikaId(process.env.YANDEX_METRIKA_ID) !== null && analyticsAllowed(request.nextUrl.pathname), ...(process.env.MEDIA_ORIGIN ? { mediaOrigin: process.env.MEDIA_ORIGIN } : {}), development: process.env.NODE_ENV !== 'production' });
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, id);
  // Next.js reads the policy of the request to put the nonce on its own scripts.
  headers.set('Content-Security-Policy', security['Content-Security-Policy']!);
  headers.set('x-nonce', nonce);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, id);
  for (const [name, value] of Object.entries(security)) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
