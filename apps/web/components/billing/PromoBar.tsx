'use client';
import { useState } from 'react';
import { type PromoInfo, describePromo } from '../../lib/billing';
import { PromoField } from './PromoField';

const WHAT: Record<string, string> = { SUBSCRIPTION: 'подписки', PASS: '«Праздник»', ADDON: 'дополнительные покупки' };
const sizeOf = (p: PromoInfo): string => (p.kind === 'PERCENT' ? `скидка ${p.value} %` : p.kind === 'FIXED' ? `скидка ${p.value} ₽` : 'бесплатный «Праздник»');

/** P7.5 · один промокод на страницу «Тариф и оплата»: его берут и кнопки тарифов, и дополнительные покупки. */
export function PromoBar() {
  const [info, setInfo] = useState<PromoInfo | null>(null);
  return (
    <section aria-label="Промокод">
      <PromoField
        check={async (code) => {
          setInfo(await describePromo(code));
          return null;
        }}
        onChange={(code) => {
          if (!code) setInfo(null);
        }}
      />
      {info && (
        <p className="lp-note" data-testid="promo-info">
          Код действует: {sizeOf(info)}, подходит для: {info.appliesTo.map((k) => WHAT[k] ?? k).join(', ')}. Цена со скидкой считается при оплате.
        </p>
      )}
      <p className="lp-note">Для бесплатного «Праздника» введите код в окне включения «Праздника» у нужной сборки — там сразу видна цена.</p>
    </section>
  );
}
