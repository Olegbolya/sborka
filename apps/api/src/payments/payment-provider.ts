/** Платёжный провайдер (P7.3): сервис оплаты работает только с этим интерфейсом, поэтому ЮKassa можно заменить на Robokassa. */
export interface CreatePaymentInput {
  /** Наш номер заказа: он же ключ идемпотентности — повтор запроса не создаёт второй платёж. */
  orderId: string;
  amountKop: number;
  description: string;
  returnUrl: string;
}

export interface CreatedPayment {
  providerPaymentId: string;
  /** Куда отправить человека для оплаты. */
  confirmationUrl: string;
}

/** Платёж так, как его видит провайдер (источник истины: вебхуку верить нельзя, платёж перечитывается). */
export interface ProviderPayment {
  id: string;
  status: 'pending' | 'succeeded' | 'canceled' | 'other';
  amountKop: number;
  /** Номер нашего заказа, переданный при создании платежа. */
  orderId: string | null;
}

export interface RefundInput {
  providerPaymentId: string;
  amountKop: number;
  idempotenceKey: string;
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  /** `null` — такого платежа у провайдера нет (подделка или чужой магазин). Сетевой сбой — исключение. */
  getPayment(providerPaymentId: string): Promise<ProviderPayment | null>;
  refund(input: RefundInput): Promise<{ refundId: string; status: string }>;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}
