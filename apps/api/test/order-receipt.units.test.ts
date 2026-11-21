import { describe, expect, it } from 'vitest';
import { receiptText } from '../src/payments/payments.service.js';

describe('D-09 · чек в списке заказов создателя', () => {
  it('D-09 · Робокасса — чек формирует она; ЮKassa — «чек выдан <дата>» после отметки владельца, до неё «чек готовится»; бесплатное и неоплаченное — без строки', () => {
    expect(receiptText({ status: 'PAID', amountKop: 19900, provider: 'robokassa', receipt: null })).toBe('чек самозанятого формирует Робокасса и присылает на почту, указанную при оплате');
    expect(receiptText({ status: 'PAID', amountKop: 34900, provider: 'yookassa', receipt: null })).toBe('чек готовится');
    expect(receiptText({ status: 'REFUNDED', amountKop: 34900, provider: 'yookassa', receipt: { issuedAt: '2026-11-15T10:00:00Z' } })).toBe('чек выдан 15.11.2026');
    expect(receiptText({ status: 'PENDING', amountKop: 34900, provider: 'robokassa', receipt: null })).toBeNull();
    expect(receiptText({ status: 'CANCELED', amountKop: 34900, provider: 'yookassa', receipt: null })).toBeNull();
    expect(receiptText({ status: 'PAID', amountKop: 0, provider: 'promo', receipt: null })).toBeNull();
    expect(receiptText({ status: 'PAID', amountKop: 34900, provider: 'manual', receipt: null })).toBeNull();
  });
});
