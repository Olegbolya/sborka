/** TS-05 · what is wrong with a link in a button or a text, found without asking anybody. */
export type LinkProblem = 'SHORTENER' | 'IP_ADDRESS' | 'BLOCKED_DOMAIN' | 'NOT_A_WEB_LINK';

/** Services that shorten links: the real address is hidden, so they are not allowed. */
export const LINK_SHORTENERS: readonly string[] = [
  'bit.ly', 'bitly.com', 't.co', 'tinyurl.com', 'goo.gl', 'is.gd', 'v.gd', 'ow.ly', 'buff.ly', 'cutt.ly', 'rb.gy', 'shorturl.at', 'tiny.cc', 'clck.ru',
  'vk.cc', 'u.to', 'qps.ru', 'clc.to', 'ya.cc', 'lnkd.in', 'surl.li', 'l.wl.co', 'trib.al', 'soo.gd', 'x.co', 'po.st', 'bl.ink', 't.ly', 'urlr.me',
  'short.io', 'shorturl.com', 'chilp.it', 'is.gd', 'git.io', 'dub.sh', 'kutt.it', 'hyperurl.co', 'm.vk.cc', 'link.tg',
];

/** The host of a link in lower case, without «www.» and the final dot; undefined for mail and phone links. */
export function hostOf(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
  return u.hostname.toLowerCase().replace(/^www\./u, '').replace(/\.$/u, '');
}

const isIpHost = (host: string): boolean => /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host) || host.startsWith('[') || /^\d+$/u.test(host) || /^0x[0-9a-f]+$/iu.test(host);

/** True when `host` is `domain` or lives under it («m.vk.cc» under «vk.cc»). */
export const hostIsUnder = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

/** The first problem of a link, or undefined. `blocked` is the domain stop-list kept in the admin. */
export function linkProblem(url: string, blocked: readonly string[] = []): LinkProblem | undefined {
  const trimmed = url.trim();
  if (/^(mailto:|tel:)/iu.test(trimmed)) return undefined;
  const host = hostOf(trimmed);
  if (host === undefined) return 'NOT_A_WEB_LINK';
  if (isIpHost(host)) return 'IP_ADDRESS';
  if (LINK_SHORTENERS.some((d) => hostIsUnder(host, d))) return 'SHORTENER';
  if (blocked.some((d) => hostIsUnder(host, foldDomain(d)))) return 'BLOCKED_DOMAIN';
  return undefined;
}

/** A domain as it is kept in the stop-list: lower case, no scheme, no «www.», no path. */
export function foldDomain(value: string): string {
  const v = value.trim().toLowerCase().replace(/^[a-z]+:\/\//u, '').replace(/^www\./u, '');
  return (v.split(/[/?#]/u)[0] ?? '').replace(/\.$/u, '');
}

