import { compileTerms, type TermSpec } from './match.js';

/**
 * TS-02 · what a field of a page must never ask for. Stems, so that declensions are found («пароль», «пароля», «паролем»);
 * short words are `exact`. Latin spellings are listed too: the dictionary and the text are both turned into Cyrillic look-alikes,
 * but a word spelled with other Latin letters («pin», «cvv») is its own entry.
 */
export const PHISHING_TERMS: readonly TermSpec[] = [
  { id: 'password', text: 'парол' },
  { id: 'password-en', text: 'password', exact: true },
  { id: 'passcode', text: 'passcode', exact: true },
  { id: 'login-of', text: 'логин от' },
  { id: 'sms-code', text: 'код из смс' },
  { id: 'sms-code-2', text: 'код из сообщени' },
  { id: 'sms-code-3', text: 'код из sms' },
  { id: 'confirm-code', text: 'код подтверждени' },
  { id: 'onetime-code', text: 'одноразов код' },
  { id: 'onetime-password', text: 'одноразов парол' },
  { id: 'cvv', text: 'cvv', exact: true },
  { id: 'cvv2', text: 'cvv2', exact: true },
  { id: 'cvc', text: 'cvc', exact: true },
  { id: 'cvc2', text: 'cvc2', exact: true },
  { id: 'card-number', text: 'номер карт' },
  { id: 'bank-card-number', text: 'номер банковской карт' },
  { id: 'card-number-en', text: 'card number' },
  { id: 'card-expiry', text: 'срок действия карт' },
  { id: 'card-data', text: 'данн карт' },
  { id: 'card-data-2', text: 'реквизит карт' },
  { id: 'pin', text: 'пин', exact: true },
  { id: 'pin-en', text: 'pin', exact: true },
  { id: 'pin-code', text: 'пин код' },
  { id: 'pin-code-glued', text: 'пинкод' },
  { id: 'seed-phrase', text: 'сид фраз' },
  { id: 'seed-phrase-en', text: 'seed phrase' },
  { id: 'secret-phrase', text: 'секретн фраз' },
  { id: 'mnemonic', text: 'мнемоническ фраз' },
  { id: 'private-key', text: 'приватн ключ' },
  { id: 'gosuslugi-data', text: 'данн госуслуг' },
  { id: 'gosuslugi-login', text: 'вход в госуслуг' },
  { id: 'passport-series', text: 'паспорт сери' },
  { id: 'series-and-number', text: 'сери и номер' },
  { id: 'passport-data', text: 'паспортн данн' },
  { id: 'code-word', text: 'кодов слов' },
  { id: 'secret-question', text: 'секретн вопрос' },
];

export const PHISHING_COMPILED = compileTerms(PHISHING_TERMS);
