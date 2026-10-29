import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { metadata } from '../app/layout.js';
import { FAQ, HELP, LEGAL_LINKS } from '../lib/landing/content.js';
import { SiteFooter } from '../components/landing/SiteChrome.js';
import { PlanCards } from '../components/landing/PlanCards.js';

vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

describe('P10.1 · главная и подвал', () => {
  it('P10.1 · метаданные закрывают сайт от поиска, пока не включён SITE_INDEXABLE', () => {
    expect(metadata.robots).toMatchObject({ index: false });
  });

  it('P10.1 · подвал ведёт на все юридические документы и на реквизиты', () => {
    const html = renderToStaticMarkup(<SiteFooter />);
    for (const l of LEGAL_LINKS) expect(html).toContain(`href="/legal/${l.type}"`);
    expect(html).toContain('Реквизиты исполнителя');
    expect(LEGAL_LINKS.map((l) => l.type)).toEqual(
      expect.arrayContaining(['terms', 'offer', 'privacy', 'pd-consent', 'dpa', 'content-rules', 'cookies', 'marketing', 'complaints', 'contacts']),
    );
  });

  it('P10.1 · вопросы-ответы и помощь написаны по-русски и без латиницы в тексте', () => {
    const text = [...FAQ.flatMap((f) => [f.q, f.a]), ...HELP.flatMap((t) => [t.title, ...t.steps])].join(' ');
    const latin = text.replace(/VK ID|Яндекс ID|blokum\.ru\/s\/|QR/g, '').match(/[A-Za-z]{2,}/g);
    expect(latin).toBeNull();
  });

  it('P10.1 · если тарифы не загрузились, страница говорит об этом, а не выдумывает цены', () => {
    const html = renderToStaticMarkup(<PlanCards plans={null} />);
    expect(html).toContain('Тарифы сейчас не загрузились');
    expect(html).not.toContain('₽');
  });
});
