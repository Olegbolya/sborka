'use client';
import { useEffect, useState } from 'react';
import { api, errorText, isApiError } from '../../lib/api-browser';
import { type AddonRow, type PromoQuote, createAddonOrder, loadAddons, quotePromo, rub, savedPromo } from '../../lib/billing';

interface ProjectRow {
  id: string;
  title: string;
}

/**
 * P7.5 · «Дополнительные покупки» (04-TARIFFS §3): прохождения, место, продление «Праздника». Покупка, которая не подходит,
 * остаётся в списке недоступной с причиной на русском — человек видит, что нужно сделать. Реклама тарифов здесь только
 * для создателя; участник этой страницы не видит.
 */
export function AddonShop() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectId, setProjectId] = useState('');
  const [addons, setAddons] = useState<AddonRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, PromoQuote>>({});
  const [promoTick, setPromoTick] = useState(0);

  // The code of the page changes the prices shown here.
  useEffect(() => {
    const on = () => setPromoTick((n) => n + 1);
    window.addEventListener('bk-promo', on);
    return () => window.removeEventListener('bk-promo', on);
  }, []);

  useEffect(() => {
    api<ProjectRow[]>('/projects')
      .then((rows) => setProjects(rows))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    let stop = false;
    loadAddons(projectId || undefined)
      .then((rows) => {
        if (!stop) setAddons(rows);
      })
      .catch((e: unknown) => {
        if (stop) return;
        if (isApiError(e) && e.status === 401) setAnonymous(true);
        else setError(errorText(e));
      });
    return () => {
      stop = true;
    };
  }, [projectId]);

  useEffect(() => {
    const code = savedPromo();
    if (!code || !addons) {
      setQuotes({});
      return;
    }
    let stop = false;
    void Promise.all(
      addons
        .filter((a) => a.available)
        .map((a) =>
          quotePromo({ kind: 'ADDON', addon: a.code, ...(a.needsProject && projectId ? { projectId } : {}) }, code)
            .then((q) => [a.code, q] as const)
            .catch(() => null),
        ),
    ).then((rows) => {
      if (!stop) setQuotes(Object.fromEntries(rows.filter((r): r is readonly [string, PromoQuote] => r !== null)));
    });
    return () => {
      stop = true;
    };
  }, [addons, projectId, promoTick]);

  const buy = async (a: AddonRow) => {
    setBusy(a.code);
    setError(null);
    try {
      const { confirmationUrl } = await createAddonOrder(a.code, a.needsProject ? projectId : undefined);
      window.location.assign(confirmationUrl);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  if (anonymous) return null;
  if (error && !addons) return <p className="lp-note" role="alert">{error}</p>;
  if (!addons) return null;

  return (
    <div data-testid="addon-shop">
      <h2 className="lp-h2">Дополнительные покупки</h2>
      <p className="lp-note">
        Покупки, которые относятся к сборке («Праздник», продление), действуют для выбранной ниже сборки.
      </p>
      <label className="lp-note" style={{ display: 'block', margin: '0 0 12px' }}>
        Сборка{' '}
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} data-testid="addon-project" aria-label="Сборка для покупки">
          <option value="">Не выбрана</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title || 'Без названия'}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="lp-note" role="alert">{error}</p>}
      <ul className="lp-plan-list" style={{ listStyle: 'none', padding: 0 }}>
        {addons.map((a) => (
          <li key={a.code} data-testid={`addon-${a.code}`} style={{ margin: '0 0 14px' }}>
            <strong>{a.title}</strong> — {a.priceRub}&nbsp;₽
            <div className="lp-note" style={{ margin: '2px 0 6px' }}>{a.description}</div>
            {a.available ? (
              <button type="button" className="lp-btn" data-testid={`addon-buy-${a.code}`} disabled={busy !== null} onClick={() => void buy(a)}>
                {busy === a.code ? 'Переходим к оплате…' : quotes[a.code] ? (quotes[a.code]!.finalKop === 0 ? 'Получить бесплатно' : `Купить за ${rub(quotes[a.code]!.finalKop)}`) : `Купить за ${a.priceRub}\u00a0₽`}
              </button>
            ) : (
              <span className="lp-note" data-testid={`addon-reason-${a.code}`}>{a.needsProject && !projectId ? 'Выберите сборку выше.' : a.reason}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
