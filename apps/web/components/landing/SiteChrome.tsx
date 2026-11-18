import type { ReactNode } from 'react';
import { LEGAL_LINKS } from '../../lib/landing/content';
import { CabinetHeader, type CabinetSection } from '../cabinet/CabinetHeader';
import { AccountLink } from './AccountLink';
import { CookieSettingsButton } from './CookieSettingsButton';
import './landing.css';

export function SiteHeader() {
  return (
    <header className="lp-header">
      <a href="/" className="lp-logo" aria-label="Блоккер — на главную">
        <span className="lp-logo-mark" aria-hidden="true" />
        Блоккер
      </a>
      <nav aria-label="Разделы сайта" className="lp-nav">
        <a href="/examples">Примеры</a>
        <a href="/tariffs">Тарифы</a>
        <a href="/help">Помощь</a>
      </nav>
      <AccountLink className="lp-btn lp-btn-small" />
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap lp-footer-grid">
        <div>
          <strong className="lp-footer-title">Блоккер</strong>
          <p>Конструктор интерактивных открыток, тестов, квизов и мини-игр. Участникам не нужна регистрация.</p>
          <p>
            <a href="/legal/contacts">Реквизиты исполнителя и контакты</a>
          </p>
          <p data-testid="site-age-mark">
            <span aria-label="Возрастная категория сайта 18+">18+</span> · сборки создают пользователи, у каждой свой возрастной знак
          </p>
        </div>
        <nav aria-label="Разделы" className="lp-footer-col">
          <strong>Сайт</strong>
          <a href="/examples">Примеры</a>
          <a href="/tariffs">Тарифы</a>
          <a href="/help">Помощь</a>
          <AccountLink />
        </nav>
        <nav aria-label="Правовые документы" className="lp-footer-col">
          <strong>Документы</strong>
          {LEGAL_LINKS.map((l) => (
            <a key={l.type} href={`/legal/${l.type}`}>
              {l.title}
            </a>
          ))}
          <CookieSettingsButton />
        </nav>
      </div>
    </footer>
  );
}

/** `cabinet` — a page of the cabinet (D-01): the same chrome, but the header shows the sections of the cabinet. */
export function SitePage({ children, cabinet }: { children: ReactNode; cabinet?: CabinetSection }) {
  return (
    <>
      <a href="#content" className="lp-skip">
        К содержимому
      </a>
      {cabinet ? <CabinetHeader current={cabinet} /> : <SiteHeader />}
      <main id="content">{children}</main>
      <SiteFooter />
    </>
  );
}
