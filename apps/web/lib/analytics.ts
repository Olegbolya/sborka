/**
 * P10.7 · 05-LEGAL.md §2.2 · Yandex Metrika is on the landing and in the cabinet only, and only after the visitor agreed in the
 * cookie banner. It is never on the pages of the player (`/s/…`, `/q/…`, the page of a link out) or of the admin: there the
 * policy of the page does not even allow a request to the counter's host.
 */
export const CONSENT_KEY = 'bk:cookie-consent';
export const METRIKA_HOST = 'https://mc.yandex.ru';
export const COOKIE_SETTINGS_EVENT = 'bk:cookie-settings';

export type Consent = 'granted' | 'denied';

/** The number of the counter from the environment; anything but digits is not a counter. */
export function metrikaId(value: string | undefined): string | null {
  const id = value?.trim() ?? '';
  return /^\d{4,12}$/.test(id) ? id : null;
}

/** Where analytics may run: not in the player of an assembly, not on the page of an outgoing link, not in the admin. */
export function analyticsAllowed(pathname: string): boolean {
  return !/^\/(s|q|out|admin|dev)(\/|$)/.test(pathname);
}

export function readConsent(storage: Pick<Storage, 'getItem'> | null): Consent | null {
  try {
    const raw = storage?.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { analytics?: unknown };
    return parsed.analytics === 'granted' || parsed.analytics === 'denied' ? parsed.analytics : null;
  } catch {
    return null;
  }
}

export function writeConsent(storage: Pick<Storage, 'setItem'> | null, value: Consent): void {
  try {
    storage?.setItem(CONSENT_KEY, JSON.stringify({ v: 1, analytics: value, at: new Date().toISOString() }));
  } catch {
    // The browser keeps nothing: the banner will come again on the next visit.
  }
}

/** Loads the counter once. No recording of sessions (webvisor), no forms: only visits. */
export function loadMetrika(id: string, doc: Document = document): void {
  const w = window as unknown as { ym?: (...args: unknown[]) => void & { a?: unknown[] }; __bkMetrika?: boolean };
  if (w.__bkMetrika) return;
  w.__bkMetrika = true;
  const queue: unknown[][] = [];
  const ym = ((...args: unknown[]) => {
    queue.push(args);
  }) as unknown as NonNullable<typeof w.ym>;
  (ym as unknown as { a: unknown[][] }).a = queue;
  w.ym = ym;
  const script = doc.createElement('script');
  script.async = true;
  script.src = `${METRIKA_HOST}/metrika/tag.js`;
  doc.head.appendChild(script);
  ym(Number(id), 'init', { defer: true, clickmap: false, trackLinks: true, accurateTrackBounce: true, webvisor: false });
}
