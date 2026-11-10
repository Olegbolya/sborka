import { compileTerms, type TermSpec } from './match.js';

/**
 * TS-03 · banks, state bodies, marketplaces, operators and social networks. A page that names them in its title or text is
 * looked at by a person before it is published (for an account younger than 30 days) or published with a warning (older).
 */
export const BRAND_TERMS: readonly TermSpec[] = [
  // state bodies
  { id: 'gosuslugi', text: 'госуслуг' },
  { id: 'fns', text: 'налогов служб' },
  { id: 'fns-short', text: 'фнс', exact: true },
  { id: 'pfr', text: 'пенсионн фонд' },
  { id: 'sfr', text: 'соцфонд' },
  { id: 'mvd', text: 'мвд', exact: true },
  { id: 'fsb', text: 'фсб', exact: true },
  { id: 'cb', text: 'центробанк' },
  { id: 'cb-2', text: 'банк росси' },
  { id: 'pochta', text: 'почта росси' },
  // banks
  { id: 'sber', text: 'сбербанк' },
  { id: 'sber-2', text: 'сбер', exact: true },
  { id: 'sber-3', text: 'сбербизнес' },
  { id: 'tinkoff', text: 'тинькофф' },
  { id: 'tbank', text: 'т банк' },
  { id: 'vtb', text: 'втб', exact: true },
  { id: 'alfa', text: 'альфа банк' },
  { id: 'alfa-2', text: 'альфабанк' },
  { id: 'gazprombank', text: 'газпромбанк' },
  { id: 'raiffeisen', text: 'райффайзен' },
  { id: 'rshb', text: 'россельхозбанк' },
  { id: 'sovcombank', text: 'совкомбанк' },
  { id: 'otkritie', text: 'банк открыти' },
  { id: 'pochtabank', text: 'почта банк' },
  { id: 'sbp', text: 'сбп', exact: true },
  { id: 'yoomoney', text: 'юмани' },
  { id: 'yoomoney-2', text: 'юmoney' },
  { id: 'qiwi', text: 'киви кошел' },
  // marketplaces and shops
  { id: 'ozon', text: 'озон', exact: true },
  { id: 'ozon-en', text: 'ozon', exact: true },
  { id: 'wb', text: 'вайлдберриз' },
  { id: 'wb-en', text: 'wildberries' },
  { id: 'avito', text: 'авито', exact: true },
  { id: 'yandex-market', text: 'яндекс маркет' },
  { id: 'aliexpress', text: 'алиэкспресс' },
  { id: 'sbermegamarket', text: 'мегамаркет' },
  { id: 'lamoda', text: 'ламода' },
  // mobile operators
  { id: 'mts', text: 'мтс', exact: true },
  { id: 'megafon', text: 'мегафон' },
  { id: 'beeline', text: 'билайн' },
  { id: 'tele2', text: 'теле2' },
  { id: 'yota', text: 'йота', exact: true },
  { id: 'rostelecom', text: 'ростелеком' },
  // social networks, mail and messengers
  { id: 'vk', text: 'вконтакте' },
  { id: 'vk-short', text: 'вк', exact: true },
  { id: 'telegram', text: 'телеграм' },
  { id: 'telegram-en', text: 'telegram' },
  { id: 'whatsapp', text: 'ватсап' },
  { id: 'whatsapp-en', text: 'whatsapp' },
  { id: 'yandex-id', text: 'яндекс id' },
  { id: 'yandex-pochta', text: 'яндекс почт' },
  { id: 'mailru', text: 'майл ру' },
];

export const BRAND_COMPILED = compileTerms(BRAND_TERMS);
