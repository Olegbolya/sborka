import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

/**
 * D-07 · ADR-129 · the webhook goes to the creator's own system, never into our network (SSRF): addresses of private, local,
 * service and documentation ranges are refused — when the address is checked on saving and again at every connection (the
 * resolved address is the one connected to, so a name that changes its address between the check and the call gains nothing).
 */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) BLOCKED.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) BLOCKED.addSubnet(net, prefix, 'ipv6');

/** true for an address on the public internet. An IPv4 address written as IPv6 (`::ffff:10.0.0.1`) is judged as IPv4. */
export function isPublicAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return isPublicAddress(mapped[1]!);
  const family = isIP(ip);
  if (family === 4) return !BLOCKED.check(ip, 'ipv4');
  if (family === 6) return !/^::ffff:/i.test(ip) && !BLOCKED.check(ip, 'ipv6');
  return false;
}

export class WebhookAddressError extends Error {}

const MAX_URL = 500;

/**
 * The address the creator typed, checked: https (http only where `allowPrivate` — the developer's own machine and tests), no
 * login or password in it, a name or a public address. Returns the normalised URL.
 */
export function parseWebhookUrl(raw: unknown, allowPrivate: boolean): URL {
  if (typeof raw !== 'string' || raw.trim() === '') throw new WebhookAddressError('Укажите адрес, на который отправлять данные.');
  const text = raw.trim();
  if (text.length > MAX_URL) throw new WebhookAddressError(`Адрес длиннее ${MAX_URL} символов.`);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new WebhookAddressError('Это не похоже на адрес сайта. Пример: https://example.ru/blokker');
  }
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) throw new WebhookAddressError('Адрес должен начинаться с https:// — данные участников передаются только по защищённому соединению.');
  if (url.username || url.password) throw new WebhookAddressError('Логин и пароль в адресе не допускаются. Проверяйте подпись запроса.');
  if (!url.hostname) throw new WebhookAddressError('В адресе нет имени сервера.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !allowPrivate && !isPublicAddress(host)) throw new WebhookAddressError('Адрес ведёт во внутреннюю сеть. Укажите сервер, доступный из интернета.');
  url.hash = '';
  return url;
}

type LookupResult = { address: string; family: number };
export type Resolver = (host: string) => Promise<LookupResult[]>;

const systemResolver: Resolver = (host) =>
  new Promise((resolve, reject) => dnsLookup(host, { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses))));

/** The addresses the name resolves to; every one of them must be public, or the name is refused (unless `allowPrivate`). */
export async function resolvePublic(host: string, allowPrivate: boolean, resolver: Resolver = systemResolver): Promise<LookupResult> {
  const bare = host.replace(/^\[|\]$/g, '');
  const family = isIP(bare);
  const found = family ? [{ address: bare, family }] : await resolver(bare).catch(() => {
    throw new WebhookAddressError('Не удалось найти такой сервер. Проверьте адрес.');
  });
  if (found.length === 0) throw new WebhookAddressError('Не удалось найти такой сервер. Проверьте адрес.');
  if (!allowPrivate && found.some((a) => !isPublicAddress(a.address))) throw new WebhookAddressError('Адрес ведёт во внутреннюю сеть. Укажите сервер, доступный из интернета.');
  return found[0]!;
}

export interface SendResult {
  ok: boolean;
  /** For the creator: «ответ 200», «ответ 500», «нет ответа за 10 с», «соединение не установлено»… */
  result: string;
}

export type WebhookSender = (url: URL, headers: Record<string, string>, body: string) => Promise<SendResult>;

const TIMEOUT_MS = 10_000;
/** Whatever the receiver answers is read up to this size and thrown away: only the status matters. */
const MAX_ANSWER = 64 * 1024;

/**
 * One POST: the connection goes to the address checked by `resolvePublic`; redirects are not followed (a redirect is a
 * failure: «HTTP 302»); no answer within 10 seconds is a failure too.
 */
export function createSender(allowPrivate: boolean, resolver: Resolver = systemResolver): WebhookSender {
  return async (url, headers, body) => {
    let target: LookupResult;
    try {
      target = await resolvePublic(url.hostname, allowPrivate, resolver);
    } catch (e) {
      return { ok: false, result: e instanceof WebhookAddressError ? e.message : 'адрес не найден' };
    }
    const lib = url.protocol === 'https:' ? https : http;
    return new Promise<SendResult>((resolve) => {
      let done = false;
      const finish = (r: SendResult): void => {
        if (done) return;
        done = true;
        resolve(r);
      };
      const req = lib.request(
        url,
        {
          method: 'POST',
          headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
          // The name stays in the request (TLS checks the certificate of that name); the address connected to is the checked one.
          lookup: (_host, options, cb) => {
            const all = typeof options === 'object' && options !== null && (options as { all?: boolean }).all;
            if (all) (cb as unknown as (e: null, a: LookupResult[]) => void)(null, [target]);
            else (cb as (e: null, a: string, f: number) => void)(null, target.address, target.family);
          },
          timeout: TIMEOUT_MS,
        },
        (res) => {
          let read = 0;
          res.on('data', (chunk: Buffer) => {
            read += chunk.length;
            if (read > MAX_ANSWER) res.destroy();
          });
          const status = res.statusCode ?? 0;
          const answer = { ok: status >= 200 && status < 300, result: `ответ ${status}` };
          res.on('end', () => finish(answer));
          res.on('close', () => finish(answer));
          res.on('error', () => finish(answer));
        },
      );
      req.on('timeout', () => {
        req.destroy();
        finish({ ok: false, result: `нет ответа за ${TIMEOUT_MS / 1000} с` });
      });
      req.on('error', (e: NodeJS.ErrnoException) => {
        const code = e.code ?? '';
        const text = code === 'ECONNREFUSED' ? 'сервер отказал в соединении' : code.startsWith('ERR_TLS') || code.includes('CERT') ? 'ошибка сертификата сервера' : 'соединение не установлено';
        finish({ ok: false, result: text });
      });
      req.end(body);
    });
  };
}
