import type { Metadata } from 'next';
import { parseOutTarget } from '../../lib/play/out';
import { externalLinksEnabled } from '../../lib/play/server';
import { OutBack } from './OutBack';
import './out.css';

export const metadata: Metadata = {
  title: 'Переход на другой сайт — Блокум',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/** PL-22, TS-12 · the safe redirect: it only shows the address; the participant goes on by a click, never by itself. */
export default async function OutPage({ searchParams }: { searchParams: Promise<{ u?: string }> }) {
  const { u } = await searchParams;
  const target = parseOutTarget(u);
  // AD-07: while the switch of external links is off the page does not offer the way out.
  if (target && !(await externalLinksEnabled())) {
    return (
      <main className="out" data-testid="out-page">
        <h1>Переходы на другие сайты временно отключены</h1>
        <p>Мы приостановили переходы по внешним ссылкам. Попробуйте позже.</p>
        <OutBack />
      </main>
    );
  }
  return (
    <main className="out" data-testid="out-page">
      {target ? (
        <>
          <h1>Вы переходите на другой сайт</h1>
          <p>Эту ссылку добавил автор сборки, Блокум её не проверял. Не вводите пароли, коды из СМС и данные банковских карт, если вас об этом просят.</p>
          <p className="out-host">{target.host || target.pathname}</p>
          <p className="out-url" data-testid="out-url">{target.href}</p>
          <div className="out-actions">
            <a className="out-go" href={target.href} rel="noopener noreferrer nofollow ugc" referrerPolicy="no-referrer">
              {target.protocol === 'mailto:' ? 'Написать письмо' : target.protocol === 'tel:' ? 'Позвонить' : 'Перейти на сайт'}
            </a>
            <OutBack />
          </div>
        </>
      ) : (
        <>
          <h1>Эту ссылку открыть нельзя</h1>
          <p>Адрес указан неверно или ведёт не на сайт.</p>
          <OutBack />
        </>
      )}
    </main>
  );
}
