'use client';
import { useEffect, useState } from 'react';
import { errorText } from '../../lib/api-browser';
import { type PromoQuote, rub, savePromo, savedPromo } from '../../lib/billing';

/**
 * P7.5 · поле «Промокод». Код запоминается на вкладке и подставляется в каждый заказ. `check` считает цену с кодом для того,
 * что человек сейчас покупает; отказ сервера («срок закончился», «лимит исчерпан») показывается как есть, по-русски.
 */
export function PromoField({ check, onChange, compact = false }: { check?: (code: string) => Promise<PromoQuote | null>; onChange?: (code: string, quote: PromoQuote | null) => void; compact?: boolean }) {
  const [code, setCode] = useState(savedPromo());
  const [applied, setApplied] = useState(savedPromo() !== '');
  const [quote, setQuote] = useState<PromoQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async (again?: string) => {
    const value = (again ?? code).trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const q = check ? await check(value) : null;
      savePromo(value);
      setApplied(true);
      setQuote(q);
      onChange?.(value, q);
    } catch (e) {
      savePromo('');
      setApplied(false);
      setQuote(null);
      setError(errorText(e));
      onChange?.('', null);
    } finally {
      setBusy(false);
    }
  };
  // A code kept from before is checked again for what is on the page now (its term may have ended).
  useEffect(() => {
    const kept = savedPromo();
    if (kept && check) void apply(kept);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the field appears
  }, []);

  const clear = () => {
    savePromo('');
    setCode('');
    setApplied(false);
    setQuote(null);
    setError(null);
    onChange?.('', null);
  };

  return (
    <div data-testid="promo-field" style={{ margin: compact ? '12px 0' : '0 0 16px' }}>
      <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>Промокод</span>
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setApplied(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void apply();
          }}
          maxLength={32}
          autoCapitalize="characters"
          autoComplete="off"
          aria-label="Промокод"
          data-testid="promo-input"
          style={{ padding: '6px 10px', fontSize: 14, borderRadius: 8, border: '1px solid var(--border, #ccc)', width: 180, textTransform: 'uppercase' }}
        />
      </label>{' '}
      <button type="button" data-testid="promo-apply" disabled={busy || code.trim() === ''} onClick={() => void apply()} style={{ padding: '6px 14px', fontSize: 14, borderRadius: 8, border: '1px solid var(--border, #ccc)', background: 'transparent', cursor: 'pointer', color: 'inherit' }}>
        Применить
      </button>
      {applied && (
        <>
          {' '}
          <button type="button" data-testid="promo-clear" onClick={clear} style={{ padding: '6px 10px', fontSize: 14, border: 'none', background: 'transparent', cursor: 'pointer', textDecoration: 'underline', color: 'inherit' }}>
            Убрать
          </button>
        </>
      )}
      {applied && quote && (
        <p role="status" data-testid="promo-result" style={{ margin: '8px 0 0' }}>
          {quote.finalKop === 0 ? 'Промокод применён: бесплатно.' : `Промокод применён: к оплате ${rub(quote.finalKop)} вместо ${rub(quote.listKop)}.`}
        </p>
      )}
      {applied && !quote && (
        <p role="status" data-testid="promo-result" style={{ margin: '8px 0 0' }}>
          Промокод запомнен: скидка применится при оплате.
        </p>
      )}
      {error && (
        <p role="alert" data-testid="promo-error" style={{ margin: '8px 0 0', color: '#dc2626' }}>
          {error}
        </p>
      )}
    </div>
  );
}
