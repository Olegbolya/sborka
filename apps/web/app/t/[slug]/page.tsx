import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { SitePage } from '../../../components/landing/SiteChrome';
import { apiFetch } from '../../../lib/api-client';
import { playMediaUrl } from '../../../lib/play/api';
import { loadPlayView } from '../../../lib/play/server';

interface TemplatePage {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  coverMediaId: string | null;
  example: { slug: string } | null;
}

async function load(slug: string): Promise<TemplatePage | null> {
  const h = await headers();
  const res = await apiFetch(`/api/v1/templates/by-slug/${encodeURIComponent(slug)}`, { requestId: h.get('x-request-id') });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Не удалось открыть шаблон (${res.status})`);
  return (await res.json()) as TemplatePage;
}

/** The label after `?src=` (episode, post…) is passed on to the building; only a safe one is kept. */
const labelOf = (raw: string | undefined): string => (raw && /^[a-z0-9][a-z0-9._-]{0,39}$/i.test(raw) ? raw.toLowerCase() : '');

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const t = await load(slug);
  if (!t) return { title: 'Шаблон не найден — Блоккер', robots: { index: false, follow: false } };
  return { title: `${t.name} — шаблон Блоккера`, description: `Попробуйте пример «${t.name}» и соберите такую же сборку у себя.` };
}

/** TPL-05.1 · the public page of a system template: the cover, the name, «Попробовать» and «Собрать такую же». It opens without signing in. */
export default async function TemplatePublicPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ src?: string }> }) {
  const { slug } = await params;
  const { src } = await searchParams;
  const t = await load(slug);
  if (!t) {
    return (
      <SitePage>
        <section className="lp-section">
          <div className="lp-wrap">
            <h1 className="lp-page-title">Шаблон не найден</h1>
            <p className="lp-lead-small">Такого шаблона нет: возможно, он снят или ссылка набрана с ошибкой. Другие шаблоны — в галерее.</p>
            <p>
              <a className="lp-btn" href="/app/new" data-testid="template-gallery-link">
                Открыть галерею шаблонов
              </a>
            </p>
          </div>
        </section>
      </SitePage>
    );
  }
  // The picture of the example (its link preview) serves as the cover: it is public, a template's own cover file is not.
  const view = t.example ? await loadPlayView(t.example.slug).catch(() => null) : null;
  const cover = view && view.state === 'ok' && view.ogImageId ? playMediaUrl(view.slug, view.ogImageId) : null;
  const label = labelOf(src);
  const build = `/t/${encodeURIComponent(t.slug)}/build${label ? `?src=${label}` : ''}`;
  return (
    <SitePage>
      <section className="lp-section">
        <div className="lp-wrap">
          {t.category && <p className="lp-note">{t.category}</p>}
          <h1 className="lp-page-title" data-testid="template-title">
            {t.name}
          </h1>
          {cover && <img src={cover} alt="" style={{ display: 'block', maxWidth: 'min(100%, 420px)', borderRadius: 16, margin: '0 0 24px' }} data-testid="template-cover" />}
          <p className="lp-lead-small">Пройдите пример, а если понравится — соберите такую же сборку у себя: она станет вашей копией, её можно менять как угодно.</p>
          <p style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {t.example && (
              <a className="lp-btn lp-btn-ghost" href={`/s/${encodeURIComponent(t.example.slug)}`} data-testid="template-try">
                Попробовать
              </a>
            )}
            <a className="lp-btn" href={build} data-testid="template-build">
              Собрать такую же
            </a>
          </p>
        </div>
      </section>
    </SitePage>
  );
}
