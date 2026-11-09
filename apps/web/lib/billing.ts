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
  item: { planCode?: string; period?: 'MONTH' | 'YEAR'; addon?: string; promo?: string };
  createdAt: string;
  paidAt: string | null;
}

export const loadBilling = (): Promise<BillingState> => api<BillingState>('/billing/me');
export const loadOrders = async (): Promise<OrderRow[]> => (await api<{ orders: OrderRow[] }>('/orders')).orders;
export const startTrial = (planCode: string): Promise<BillingState> => api<BillingState>('/billing/trial', { method: 'POST', body: { planCode } });
/** P7.5 · the promo code the person entered is kept for the tab: every «Оплатить» of this session takes it. */
const PROMO_KEY = 'bk:promo';
export const savedPromo = (): string => {
  try {
    return window.sessionStorage.getItem(PROMO_KEY) ?? '';
  } catch {
    return '';
  }
};
export const savePromo = (code: string): void => {
  try {
    if (code) window.sessionStorage.setItem(PROMO_KEY, code);
    else window.sessionStorage.removeItem(PROMO_KEY);
  } catch {
    // The browser does not keep it: the code is entered again.
  }
  // The other blocks of the page (the extra purchases) recount their prices.
  window.dispatchEvent(new Event('bk-promo'));
};
const withPromo = <T extends object>(body: T): T & { promo?: string } => {
  const promo = savedPromo();
  return promo ? { ...body, promo } : body;
};

export interface PromoQuote {
  listKop: number;
  discountKop: number;
  finalKop: number;
  code: string;
}
/** The price with the code, before the payment; nothing is used up. */
export const quotePromo = (body: Record<string, unknown>, promo: string): Promise<PromoQuote> => api<PromoQuote>('/promo/check', { method: 'POST', body: { ...body, promo } });

export interface PromoInfo {
  code: string;
  kind: 'PERCENT' | 'FIXED' | 'FREE_PASS';
  value: number;
  appliesTo: string[];
}
/** The code on its own (nothing is being bought on the page): does it work for this person, and what does it give. */
export const describePromo = (promo: string): Promise<PromoInfo> => api<PromoInfo>('/promo/check', { method: 'POST', body: { promo } });

export const createOrder = (body: { kind: 'SUBSCRIPTION'; planCode: string; period: 'MONTH' | 'YEAR' }): Promise<{ orderId: string; confirmationUrl: string }> =>
  api('/orders', { method: 'POST', body: withPromo(body) });

export const createPassOrder = (projectId: string): Promise<{ orderId: string; confirmationUrl: string }> =>
  api('/orders', { method: 'POST', body: withPromo({ kind: 'PASS', projectId }) });

/** P7.5 · дополнительная покупка из каталога (`GET /billing/addons`). */
export interface AddonRow {
  code: string;
  title: string;
  description: string;
  priceRub: number;
  needsProject: boolean;
  available: boolean;
  reason: string | null;
}

export const loadAddons = async (projectId?: string): Promise<AddonRow[]> =>
  (await api<{ addons: AddonRow[] }>(`/billing/addons${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`)).addons;

export const createAddonOrder = (addon: string, projectId?: string): Promise<{ orderId: string; confirmationUrl: string }> =>
  api('/orders', { method: 'POST', body: withPromo({ kind: 'ADDON', addon, ...(projectId ? { projectId } : {}) }) });

export const ORDER_STATUS_LABEL: Record<OrderRow['status'], string> = {
  PENDING: 'Ждёт оплаты',
  PAID: 'Оплачен',
  CANCELED: 'Не оплачен',
  REFUNDED: 'Возвращён',
};

export const rub = (kop: number): string =>
  `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: kop % 100 === 0 ? 0 : 2 }).format(kop / 100).replace(/\u202f/g, '\u00a0')}\u00a0₽`;
export const dateRu = (iso: string): string => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
