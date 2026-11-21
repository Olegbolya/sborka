import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { type CreatedPayment, type CreatePaymentInput, type PaymentProvider, PaymentProviderError, type ProviderPayment, type RefundInput } from './payment-provider.js';

type Fetch = typeof fetch;
export type RobokassaHash = 'md5' | 'sha256' | 'sha384' | 'sha512';

export interface RobokassaOptions {
  login: string;
  /** Пароль №1 — подпись ссылки на оплату. */
  password1: string;
  /** Пароль №2 — подпись уведомления ResultURL и запроса состояния (OpStateExt). */
  password2: string;
  /** Пароль №3 — подпись (JWT) запросов к API возвратов. */
  password3: string;
  /** Алгоритм подписи — как выбран в технических настройках магазина (по умолчанию MD5). */
  hash?: RobokassaHash;
  /** `IsTest=1`: тестовые платежи; состояние такого платежа сервис не отдаёт, поэтому на боевом магазине режим выключен. */
  test?: boolean;
}

const PAY_URL = 'https://auth.robokassa.ru/Merchant/Index.aspx';
const OP_STATE_URL = 'https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt';
const REFUND_CREATE_URL = 'https://services.robokassa.ru/RefundService/Refund/Create';

const rubles = (kop: number): string => (kop / 100).toFixed(2);
const kopecks = (value: string): number => Math.round(Number(value) * 100);
const b64url = (data: Buffer | string): string => Buffer.from(data).toString('base64url');

/** Тег первого вхождения внутри куска XML: `<Code>5</Code>` → `5`. */
function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1]!.trim() : null;
}

/**
 * Robokassa (https://docs.robokassa.ru): человек платит на странице магазина по подписанной ссылке (пароль №1); о платеже
 * сообщает ResultURL с подписью по паролю №2. Уведомлению не верим на слово: платёж перечитывается запросом OpStateExt.
 * Номер счёта `InvId` у Robokassa — число, поэтому он выводится из нашего номера заказа одинаково при каждом вызове.
 */
export class RobokassaProvider implements PaymentProvider {
  readonly name = 'robokassa';
  private readonly algo: RobokassaHash;

  constructor(
    private readonly o: RobokassaOptions,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    this.algo = o.hash ?? 'md5';
  }

  private sign(...parts: string[]): string {
    return createHash(this.algo).update(parts.join(':')).digest('hex');
  }

  /** Число из номера заказа: 52 бита хэша, всегда целое и меньше 2^63. Столкновение поймает уникальный индекс заказов. */
  static invId(orderId: string): string {
    return String(Number.parseInt(createHash('sha256').update(orderId).digest('hex').slice(0, 13), 16) + 1);
  }

  createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const invId = RobokassaProvider.invId(input.orderId);
    const outSum = rubles(input.amountKop);
    // Состав покупки для чека «Робочеки СМЗ» (54-ФЗ, 422-ФЗ): одна услуга на всю сумму, без НДС — самозанятый НДС не платит.
    const receipt = JSON.stringify({
      items: [{ name: input.description.slice(0, 128), quantity: 1, sum: Number(outSum), payment_method: 'full_payment', payment_object: 'service', tax: 'none' }],
    });
    // Подпись: MerchantLogin:OutSum:InvId:Receipt:Пароль1:Shp_… (Receipt — JSON как есть, в ссылке он URL-кодируется; Shp_ — по алфавиту).
    const shp = `Shp_order=${input.orderId}`;
    const params = new URLSearchParams({
      MerchantLogin: this.o.login,
      OutSum: outSum,
      InvId: invId,
      Description: input.description.slice(0, 100),
      Shp_order: input.orderId,
      Receipt: receipt,
      SignatureValue: this.sign(this.o.login, outSum, invId, receipt, this.o.password1, shp),
      Culture: 'ru',
      Encoding: 'utf-8',
      SuccessUrl2: input.returnUrl,
      SuccessUrl2Method: 'GET',
      ...(this.o.test ? { IsTest: '1' } : {}),
    });
    // SuccessUrl2 входит в подпись (после пароля нельзя — «модификаторы» идут перед паролем), поэтому ссылку возврата настраивает кабинет магазина.
    params.delete('SuccessUrl2');
    params.delete('SuccessUrl2Method');
    return Promise.resolve({ providerPaymentId: invId, confirmationUrl: `${PAY_URL}?${params.toString()}` });
  }

  /** Разобрать ResultURL: подпись `OutSum:InvId:Пароль2:Shp_…`. Подделка — `null`. */
  parseResultNotification(params: Record<string, unknown>): { paymentId: string; reply: string } | null {
    const outSum = typeof params.OutSum === 'string' ? params.OutSum : null;
    const invId = typeof params.InvId === 'string' ? params.InvId : null;
    const signature = typeof params.SignatureValue === 'string' ? params.SignatureValue : null;
    if (!outSum || !invId || !signature || !/^\d{1,19}$/.test(invId)) return null;
    const shp = Object.keys(params)
      .filter((k) => k.toLowerCase().startsWith('shp_'))
      .sort((a, b) => a.localeCompare(b))
      .map((k) => `${k}=${String(params[k])}`);
    const mine = this.sign(outSum, invId, this.o.password2, ...shp);
    // Constant time: the comparison does not tell, by how long it took, how much of a forged signature was right.
    const a = Buffer.from(mine.toLowerCase());
    const b = Buffer.from(signature.toLowerCase());
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { paymentId: invId, reply: `OK${invId}` };
  }

  private async opState(invId: string): Promise<{ code: number; stateCode: number | null; outSum: string | null; opKey: string | null; orderId: string | null } | null> {
    if (!/^\d{1,19}$/.test(invId)) return null;
    const url = `${OP_STATE_URL}?${new URLSearchParams({ MerchantLogin: this.o.login, InvoiceID: invId, Signature: this.sign(this.o.login, invId, this.o.password2) }).toString()}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new PaymentProviderError('Платёжный сервис не ответил');
    }
    if (!res.ok) throw new PaymentProviderError(`Платёжный сервис не отдал платёж (${res.status})`, res.status);
    const xml = await res.text();
    const code = Number(tag(tag(xml, 'Result') ?? '', 'Code'));
    if (code === 3) return null; // операции нет — подделка или чужой магазин
    if (code === 1 || code === 2 || code === 4 || code === 1000 || !Number.isFinite(code)) throw new PaymentProviderError(`Платёжный сервис ответил кодом ${String(code)}`);
    const state = tag(xml, 'State') ?? '';
    const info = tag(xml, 'Info') ?? '';
    let orderId: string | null = null;
    for (const f of xml.matchAll(/<Field>([\s\S]*?)<\/Field>/g)) {
      const name = tag(f[1]!, 'Name')?.toLowerCase().replace(/^shp_/, '');
      if (name === 'order') orderId = tag(f[1]!, 'Value');
    }
    const stateCode = Number(tag(state, 'Code'));
    // IncSum — what the buyer paid (the sum of the order); OutSum — what reached the shop after the commission (199 ₽ → 191,24 ₽).
    return { code, stateCode: Number.isFinite(stateCode) ? stateCode : null, outSum: tag(info, 'IncSum') ?? tag(info, 'OutSum'), opKey: tag(info, 'OpKey'), orderId };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment | null> {
    const s = await this.opState(providerPaymentId);
    if (!s || s.outSum === null) return null;
    // 100 — платёж завершён; 5 и 50 — ещё в пути; 10 и 60 — деньги не получены или возвращены.
    const status = s.stateCode === 100 ? 'succeeded' : s.stateCode === 10 || s.stateCode === 60 ? 'canceled' : s.stateCode === 5 || s.stateCode === 50 ? 'pending' : 'other';
    return { id: providerPaymentId, status, amountKop: kopecks(s.outSum), orderId: s.orderId };
  }

  /** JWT HS256 с паролем №3: заголовок и тело — компактный JSON. */
  private jwt(payload: Record<string, unknown>): string {
    const head = b64url(JSON.stringify({ typ: 'JWT', alg: 'HS256' }));
    const body = b64url(JSON.stringify(payload));
    return `${head}.${body}.${b64url(createHmac('sha256', this.o.password3).update(`${head}.${body}`).digest())}`;
  }

  async refund(input: RefundInput): Promise<{ refundId: string; status: string }> {
    const s = await this.opState(input.providerPaymentId);
    if (!s?.opKey) throw new PaymentProviderError('У платежа нет ключа операции — вернуть деньги нельзя');
    let res: Response;
    try {
      res = await this.fetchImpl(REFUND_CREATE_URL, {
        method: 'POST',
        // Тело — JWT как JSON-строка (в кавычках), Content-Type application/json: на `application/jwt` Робокасса отвечает 415 (20.11.2026).
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.jwt({ OpKey: s.opKey, RefundSum: Number(rubles(input.amountKop)) })),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new PaymentProviderError('Платёжный сервис не ответил');
    }
    if (!res.ok) throw new PaymentProviderError(`Платёжный сервис отказал в возврате (${res.status}${await res.text().then((t) => (t ? `: ${t.slice(0, 200)}` : '')).catch(() => '')})`, res.status);
    const r = (await res.json()) as { success?: boolean; message?: string; requestId?: string };
    if (!r.success || !r.requestId) throw new PaymentProviderError(r.message ? `Платёжный сервис отказал в возврате: ${r.message}` : 'Платёжный сервис отказал в возврате');
    return { refundId: r.requestId, status: 'processing' };
  }
}
