'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { COOKIE_SETTINGS_EVENT, type Consent, analyticsAllowed, loadMetrika, readConsent, writeConsent } from '../../lib/analytics';

/**
 * P10.7 · the cookie banner (05-LEGAL.md §2.2). Without a counter in the settings of the server there is nothing to agree to
 * and the banner does not appear. To refuse is as easy as to agree: two buttons of the same size. The choice is kept in the
 * browser and can be changed from «Настройки cookie» in the footer.
 */
export function CookieBanner({ metrikaId }: { metrikaId: string | null }) {
  const pathname = usePathname();
  const allowed = metrikaId !== null && analyticsAllowed(pathname);
  const [consent, setConsent] = useState<Consent | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const stored = readConsent(window.localStorage);
    setConsent(stored);
    setOpen(stored === null);
  }, []);

  useEffect(() => {
    if (!allowed || consent !== 'granted' || !metrikaId) return;
    loadMetrika(metrikaId);
  }, [allowed, consent, metrikaId]);

  useEffect(() => {
    const reopen = () => setOpen(true);
    window.addEventListener(COOKIE_SETTINGS_EVENT, reopen);
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, reopen);
  }, []);

  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);

  if (!allowed || consent === undefined || !open) return null;

  const choose = (value: Consent) => {
    const withdrawn = consent === 'granted' && value === 'denied';
    writeConsent(window.localStorage, value);
    setConsent(value);
    setOpen(false);
    // The counter that is already running cannot be stopped from outside: the page is read again without it.
    if (withdrawn) window.location.reload();
  };

  return (
    <div className="lp-cookie" role="dialog" aria-label="Файлы cookie" data-testid="cookie-banner">
      <p>
        Мы можем включить Яндекс Метрику, чтобы понимать, какие страницы сайта полезны. Она работает только на главной, в справке и в кабинете, никогда — на страницах сборок. Без вашего согласия она не включается.{' '}
        <a href="/legal/cookies">Подробнее о cookie</a>
      </p>
      <div className="lp-cookie-actions">
        <button ref={first} type="button" className="lp-btn lp-btn-small" onClick={() => choose('granted')}>
          Согласен
        </button>
        <button type="button" className="lp-btn lp-btn-small" onClick={() => choose('denied')}>
          Отказаться
        </button>
      </div>
    </div>
  );
}
