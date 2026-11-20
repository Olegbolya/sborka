import { createHash, createHmac } from 'node:crypto';
import { vi } from 'vitest';

/* Поддельные платёжные сервисы для тестов оплаты (P7.3, ADR-113): общие для тестов ЮKassa, Robokassa и переключения. */

/** Поддельный сервер ЮKassa: платежи в памяти, ответы того же вида, что у API v3. */
export function fakeYooKassa() {
  const payments = new Map<string, { id: string; status: string; amount: { value: string; currency: string }; metadata: Record<string, unknown> }>();
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];
  let seq = 0;
  const impl = vi.fn((url: string | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.href;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ method: init?.method ?? 'GET', url: u, headers, body });
    const json = (status: number, data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { status }));
    if (u.endsWith('/payments') && init?.method === 'POST') {
      const id = `2f${String(++seq).padStart(10, '0')}-000f-5000-9000-1b2c3d4e5f60`;
      const b = body as { amount: { value: string; currency: string }; metadata: Record<string, unknown> };
      payments.set(id, { id, status: 'pending', amount: b.amount, metadata: b.metadata });
      return json(200, { ...payments.get(id), confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.example/checkout/${id}` } });
    }
    const m = /\/payments\/([^/]+)$/.exec(u);
    if (m && (init?.method ?? 'GET') === 'GET') {
      const p = payments.get(m[1]!);
      return p ? json(200, p) : json(404, { type: 'error', code: 'not_found' });
    }
    if (u.endsWith('/refunds')) return json(200, { id: `rf-${++seq}`, status: 'succeeded' });
    return json(500, {});
  });
  return { impl: impl as unknown as typeof fetch, payments, calls };
}

export const OPTS = { login: 'blokker-test', password1: 'pass-one', password2: 'pass-two', password3: 'pass-three' };
export const md5 = (s: string) => createHash('md5').update(s).digest('hex');

/**
 * Поддельный сервер Robokassa: состояние операций в памяти, ответы того же вида, что у OpStateExt и API возвратов. Как у настоящей:
 * IncSum — сколько заплатил покупатель (`outSum` операции — сумма, которую сайт передал в ссылке оплаты), OutSum — сколько дошло
 * до магазина за вычетом комиссии (20.11.2026: оплата 199 ₽, на балансе 191,24 ₽).
 */
export function fakeRobokassa() {
  const ops = new Map<string, { code: number; outSum: string; order: string; noFields?: boolean }>();
  const refunds: Array<{ opKey: string; sum: number; auth: string }> = [];
  const impl = vi.fn((url: string | URL, init?: RequestInit) => {
    const u = new URL(typeof url === 'string' ? url : url.href);
    const xml = (body: string) => Promise.resolve(new Response(`<?xml version="1.0" encoding="utf-8"?><OperationStateResponse>${body}</OperationStateResponse>`, { status: 200 }));
    if (u.pathname.endsWith('/OpStateExt')) {
      const inv = u.searchParams.get('InvoiceID')!;
      if (u.searchParams.get('Signature') !== md5(`${OPTS.login}:${inv}:${OPTS.password2}`)) return xml('<Result><Code>2</Code></Result>');
      const op = ops.get(inv);
      if (!op) return xml('<Result><Code>3</Code></Result>');
      return xml(
        `<Result><Code>0</Code></Result><State><Code>${op.code}</Code></State><Info><IncCurrLabel>BankCardPSR</IncCurrLabel><IncSum>${op.outSum}</IncSum><PaymentMethod><Code>BankCard</Code><Description>Банковская карта</Description></PaymentMethod><OutCurrLabel>RUB</OutCurrLabel><OutSum>${(Number(op.outSum) * 0.961).toFixed(6)}</OutSum><OpKey>key-${inv}</OpKey></Info>${op.noFields ? '' : `<UserField><Field><Name>shp_order</Name><Value>${op.order}</Value></Field></UserField>`}`,
      );
    }
    if (u.pathname.endsWith('/Refund/Create')) {
      const [h, b, s] = (init?.body as string).split('.');
      const ok = s === createHmac('sha256', OPTS.password3).update(`${h}.${b}`).digest('base64url');
      const p = JSON.parse(Buffer.from(b!, 'base64url').toString()) as { OpKey: string; RefundSum: number };
      refunds.push({ opKey: p.OpKey, sum: p.RefundSum, auth: ok ? 'ok' : 'bad' });
      return Promise.resolve(new Response(JSON.stringify(ok ? { success: true, requestId: 'rq-1' } : { success: false, message: 'bad jwt' }), { status: 200 }));
    }
    return Promise.resolve(new Response('', { status: 500 }));
  });
  return { impl: impl as unknown as typeof fetch, ops, refunds };
}
