import { type AddonParams } from './schema/billing.js';

const GB = 1024 * 1024 * 1024;

export interface AddonSeed {
  code: string;
  title: string;
  description: string;
  priceRub: number;
  sort: number;
  params: AddonParams;
}

/** Extra purchases from docs/04-TARIFFS.md §3; the seed creates missing rows and never overwrites prices edited in the admin. */
export const ADDONS: readonly AddonSeed[] = [
  {
    code: 'PASS_COMPLETIONS_500',
    title: '+500 прохождений для «Праздника»',
    description: 'Добавляет 500 прохождений к сборке с пропуском «Праздник». Действует до конца пропуска.',
    priceRub: 99,
    sort: 10,
    params: { effect: 'PASS_COMPLETIONS', quantity: 500 },
  },
  {
    code: 'PASS_EXTEND_30',
    title: 'Продление «Праздника» на 30 дней',
    description: 'Продлевает пропуск «Праздник» для той же сборки ещё на 30 дней.',
    priceRub: 99,
    sort: 20,
    params: { effect: 'PASS_EXTEND', days: 30 },
  },
  {
    code: 'COMPLETIONS_1000',
    title: '+1 000 прохождений',
    description: 'Для подписок. Расходуются после месячного лимита и действуют 12 месяцев.',
    priceRub: 149,
    sort: 30,
    params: { effect: 'SUBSCRIPTION_COMPLETIONS', quantity: 1000, months: 12 },
  },
  {
    code: 'STORAGE_10GB',
    title: '+10 ГБ хранилища на месяц',
    description: 'Для подписок. Добавляет 10 ГБ к хранилищу на 30 дней; можно купить несколько раз.',
    priceRub: 149,
    sort: 40,
    params: { effect: 'SUBSCRIPTION_STORAGE', quantity: 10 * GB, months: 1 },
  },
  {
    code: 'FREE_EXTRAS',
    title: '+5 своих тем и +100 правил для «Старта»',
    description: 'Навсегда, пока у вас тариф «Старт». Водяной знак остаётся.',
    priceRub: 99,
    sort: 50,
    params: { effect: 'FREE_EXTRAS', themes: 5, rules: 100 },
  },
];
