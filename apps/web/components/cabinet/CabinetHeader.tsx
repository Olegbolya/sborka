import '../landing/landing.css';

export type CabinetSection = 'projects' | 'themes' | 'billing' | 'account';

const LINKS: Array<{ key: Exclude<CabinetSection, 'account'>; href: string; title: string }> = [
  { key: 'projects', href: '/cabinet/projects', title: 'Мои сборки' },
  { key: 'themes', href: '/app/themes', title: 'Мои темы' },
  { key: 'billing', href: '/cabinet/billing', title: 'Тариф и оплата' },
];

/**
 * D-01 · шапка кабинета в том же виде, что и на лендинге: логотип ведёт на главную, разделы кабинета — ссылками,
 * «Аккаунт» — красной кнопкой, как «Кабинет» на публичных страницах. Текущий раздел отмечен (`aria-current`).
 * На телефоне разделы не прячутся, как на лендинге, а уходят второй строкой: без них из кабинета некуда перейти.
 */
export function CabinetHeader({ current }: { current: CabinetSection }) {
  return (
    <header className="lp-header lp-header-cabinet" data-testid="cabinet-header">
      <a href="/" className="lp-logo" aria-label="Блоккер — на главную">
        <span className="lp-logo-mark" aria-hidden="true" />
        Блоккер
      </a>
      <nav aria-label="Разделы кабинета" className="lp-nav">
        {LINKS.map((l) => (
          <a key={l.key} href={l.href} aria-current={current === l.key ? 'page' : undefined} data-testid={`cabinet-nav-${l.key}`}>
            {l.title}
          </a>
        ))}
      </nav>
      <a href="/account" className="lp-btn lp-btn-small" aria-current={current === 'account' ? 'page' : undefined} data-testid="cabinet-nav-account">
        Аккаунт
      </a>
    </header>
  );
}
