/** PL-22, TS-12 · every link of a creator leads through the page «Вы переходите на другой сайт»: the participant sees where, and goes by a click. */
const MAX_URL = 2000;

/** The address a link may lead to: a web address (no login in it), a mail or a phone link — the same as the text of a creator may hold (`SafeHref`); anything else is not followed. */
export function parseOutTarget(raw: string | null | undefined): URL | null {
  if (!raw || raw.length > MAX_URL) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol === 'mailto:' || url.protocol === 'tel:') return url;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  return url;
}

/** Where a link of the player really goes: the page of the safe redirect (a link that is not allowed leads nowhere). */
export const outHref = (url: string): string => (parseOutTarget(url) ? `/out?u=${encodeURIComponent(url)}` : '#');
