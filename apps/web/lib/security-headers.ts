/**
 * N-04, docs/02-ARCHITECTURE.md §8 п. 2 · the security headers of every page the site sends: a strict CSP (no `unsafe-eval`;
 * a script runs only with the nonce of the request, an inline style attribute is the one thing that is let in), no sniffing of
 * types, the referrer shortened, sensors off except on the pages of the player. HSTS is the business of nginx (it knows about TLS).
 */
export interface HeaderOptions {
  nonce: string;
  /** Address of the media domain, when files are served from another host (`MEDIA_ORIGIN`). */
  mediaOrigin?: string;
  /** In development React needs `eval` to rebuild stacks; the production build never gets it. */
  development?: boolean;
}

export function contentSecurityPolicy({ nonce, mediaOrigin, development = false }: HeaderOptions): string {
  const media = mediaOrigin ? ` ${mediaOrigin}` : '';
  const directives: Array<[string, string]> = [
    ['default-src', "'self'"],
    // `strict-dynamic`: scripts that a trusted script loads are trusted too; 'wasm-unsafe-eval' is for the animation player (WebAssembly).
    ['script-src', `'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${development ? " 'unsafe-eval'" : ''}`],
    ['style-src-elem', `'self' 'nonce-${nonce}'`],
    // The inline `style` of a block is how the renderer places it; it cannot carry a nonce.
    ['style-src-attr', "'unsafe-inline'"],
    ['img-src', `'self' data: blob:${media}`],
    ['media-src', `'self' blob:${media}`],
    ['font-src', `'self' data:${media}`],
    ['connect-src', `'self'${media}${development ? ' ws:' : ''}`],
    ['worker-src', "'self' blob:"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
  ];
  return directives.map(([name, value]) => `${name} ${value}`).join('; ');
}

/** Sensors of motion work only on the pages of the player (`/s/…`, `/q/…`) and the preview of the editor. */
export function permissionsPolicy(pathname: string): string {
  const motion = /^\/(s|q)\//.test(pathname) || pathname.startsWith('/app/projects/') ? '(self)' : '()';
  return `accelerometer=${motion}, gyroscope=${motion}, magnetometer=(), camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()`;
}

export function securityHeaders(pathname: string, options: HeaderOptions): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(options),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': permissionsPolicy(pathname),
    'X-Frame-Options': 'DENY',
  };
}

/** A fresh unguessable value for one request. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
