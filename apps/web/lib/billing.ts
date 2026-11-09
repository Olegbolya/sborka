import { api } from './api-browser';

/** P7.6 · состояние тарифа человека, как его отдаёт сервер (`GET /billing/me`). */
export interface BillingState {
  plan: { code: string; title: string };
  subscription: { planCode: string; status: string; trial: boolean; currentPeriodEnd: string; renewMode: 'AUTO' | 'LINK' } | null;
  trialUsed: boolean;
}

export interface OrderRow {
  id: string;
  kind: 'SUBSCRIPTION' | 'PASS' | 'ADDON';
  status: 'PENDING' | 'PAID' | 'CANCELED' | 'REFUNDED';
  amountKop: number;
  item: { planCode?: string; period?: 'MONTH' | 'YEAR' };
  createdAt: string;
  paidAt: string | null;
}

export const loadBilling = (): Promise<BillingState> => api<BillingState>('/billing/me');
export const loadOrders = async (): Promise<OrderRow[]> => (await api<{ orders: OrderRow[] }>('/orders')).orders;
export const startTrial = (planCode: string): Promise<BillingState> => api<BillingState>('/billing/trial', { method: 'POST', body: { planCode } });
export const createOrder = (body: { kind: 'SUBSCRIPTION'; planCode: string; period: 'MONTH' | 'YEAR' }): Promise<{ orderId: string; confirmationUrl: string }> =>
  api('/orders', { method: 'POST', body });

export const ORDER_STATUS_LABEL: Record<OrderRow['status'], string> = {
  PENDING: 'Ждёт оплаты',
  PAID: 'Оплачен',
  CANCELED: 'Не оплачен',
  REFUNDED: 'Возвращён',
};

export const rub = (kop: number): string => `${new Intl.NumberFormat('ru-RU').format(kop / 100).replace(/\u202f/g, '\u00a0')}\u00a0₽`;
export const dateRu = (iso: string): string => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
