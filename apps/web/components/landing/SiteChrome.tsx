import type { ReactNode } from 'react';
import { LEGAL_LINKS } from '../../lib/landing/content';
import './landing.css';

export function SiteHeader() {
  return (
    <header className="lp-header">
      <a href="/" className="lp-logo" aria-label="Блокум — на главную">
        <span className="lp-logo-mark" aria-hidden="true" />
        Блокум
      </a>
      <nav aria-label="Разделы сайта" className="lp-nav">
        <a href="/examples">Примеры</a>
        <a href="/tariffs">Тарифы</a>
        <a href="/help">Помощь</a>
      </nav>
      <a href="/login" className="lp-btn lp-btn-small">
        Войти
      </a>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap lp-footer-grid">
        <div>
          <strong className="lp-footer-title">Блокум</strong>
          <p>Конструктор интерактивных открыток, тестов, квизов и мини-игр. Участникам не нужна регистрация.</p>
          <p>
            <a href="/legal/contacts">Реквизиты исполнителя и контакты</a>
          </p>
        </div>
        <nav aria-label="Разделы" className="lp-footer-col">
          <strong>Сайт</strong>
          <a href="/examples">Примеры</a>
          <a href="/tariffs">Тарифы</a>
          <a href="/help">Помощь</a>
          <a href="/login">Войти</a>
        </nav>
        <nav aria-label="Правовые документы" className="lp-footer-col">
          <strong>Документы</strong>
          {LEGAL_LINKS.map((l) => (
            <a key={l.type} href={`/legal/${l.type}`}>
              {l.title}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}

export function SitePage({ children }: { children: ReactNode }) {
  return (
    <>
      <a href="#content" className="lp-skip">
        К содержимому
      </a>
      <SiteHeader />
      <main id="content">{children}</main>
      <SiteFooter />
    </>
  );
}
