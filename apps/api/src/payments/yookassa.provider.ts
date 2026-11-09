import { type CreatedPayment, type CreatePaymentInput, type PaymentProvider, PaymentProviderError, type ProviderPayment, type RefundInput } from './payment-provider.js';

type Fetch = typeof fetch;

interface YooAmount {
  value: string;
  currency: string;
}
interface YooPayment {
  id: string;
  status: string;
  amount: YooAmount;
  metadata?: Record<string, unknown>;
  confirmation?: { confirmation_url?: string };
}

const rubles = (kop: number): string => (kop / 100).toFixed(2);
const kopecks = (value: string): number => Math.round(Number(value) * 100);

/**
 * ЮKassa, API v3 (https://yookassa.ru/developers/api): вход по ShopID и секретному ключу (Basic), идемпотентность — заголовок
 * `Idempotence-Key`. Подлинность уведомлений проверяется не подписью, а повторным запросом платежа по его номеру.
 */
export class YooKassaProvider implements PaymentProvider {
  readonly name = 'yookassa';

  constructor(
    private readonly shopId: string,
    private readonly secretKey: string,
    private readonly fetchImpl: Fetch = fetch,
    private readonly baseUrl = 'https://api.yookassa.ru/v3',
  ) {}

  private async call(method: 'GET' | 'POST', path: string, body?: unknown, idempotenceKey?: string): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64')}`,
      'Content-Type': 'application/json',
    };
    if (idempotenceKey) headers['Idempotence-Key'] = idempotenceKey;
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new PaymentProviderError('Платёжный сервис не ответил');
    }
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const res = await this.call(
      'POST',
      '/payments',
      {
        amount: { value: rubles(input.amountKop), currency: 'RUB' },
        capture: true,
        confirmation: { type: 'redirect', return_url: input.returnUrl },
        description: input.description.slice(0, 128),
        metadata: { orderId: input.orderId },
      },
      input.orderId,
    );
    if (!res.ok) throw new PaymentProviderError(`Платёжный сервис отказал в создании платежа (${res.status})`, res.status);
    const p = (await res.json()) as YooPayment;
    const url = p.confirmation?.confirmation_url;
    if (!p.id || !url) throw new PaymentProviderError('Платёжный сервис не вернул ссылку на оплату');
    return { providerPaymentId: p.id, confirmationUrl: url };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment | null> {
    if (!/^[0-9a-zA-Z-]{10,64}$/.test(providerPaymentId)) return null;
    const res = await this.call('GET', `/payments/${providerPaymentId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new PaymentProviderError(`Платёжный сервис не отдал платёж (${res.status})`, res.status);
    const p = (await res.json()) as YooPayment;
    const status = p.status === 'succeeded' || p.status === 'canceled' || p.status === 'pending' ? p.status : 'other';
    const orderId = typeof p.metadata?.orderId === 'string' ? p.metadata.orderId : null;
    return { id: p.id, status, amountKop: kopecks(p.amount.value), orderId };
  }

  async refund(input: RefundInput): Promise<{ refundId: string; status: string }> {
    const res = await this.call('POST', '/refunds', { payment_id: input.providerPaymentId, amount: { value: rubles(input.amountKop), currency: 'RUB' } }, input.idempotenceKey);
    if (!res.ok) throw new PaymentProviderError(`Платёжный сервис отказал в возврате (${res.status})`, res.status);
    const r = (await res.json()) as { id: string; status: string };
    return { refundId: r.id, status: r.status };
  }
}
