'use client';
import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../../lib/api-browser';

type Provider = 'vk' | 'yandex';
interface Identity {
  provider: Provider | 'phone';
  createdAt: string;
}
interface Preview {
  provider: Provider;
  other: { displayName: string; createdAt: string; projects: number; themes: number; plan: string | null };
}

const TITLE: Record<string, string> = { vk: 'ВКонтакте (VK ID)', yandex: 'Яндекс ID', phone: 'Телефон' };
const SHORT: Record<Provider, string> = { vk: 'ВКонтакте', yandex: 'Яндекс ID' };
const LINK_ERROR: Record<string, string> = {
  taken: 'К аккаунту уже привязан другой вход этого сервиса. Сначала отвяжите его, потом привяжите нужный.',
  blocked: 'Этот вход принадлежит заблокированному аккаунту — привязать его нельзя.',
  oauth: 'Сервис входа не ответил или вход отменён. Попробуйте ещё раз.',
};
const date = (iso: string): string => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

interface Styles {
  section: CSSProperties;
  sectionTitle: CSSProperties;
  li: CSSProperties;
  list: CSSProperties;
  btn: CSSProperties;
  btnSecondary: CSSProperties;
  notice: CSSProperties;
  error: CSSProperties;
  ok: CSSProperties;
  confirmBox: CSSProperties;
}

/**
 * A-06 · «Способы входа»: через что можно войти; второй вход привязывается, лишний отвязывается. Если у привязываемого входа уже
 * есть свой аккаунт, сайт возвращается сюда с предложением объединить: показывает, что в том аккаунте, и объединяет по согласию.
 */
export function LoginMethods({ s, onMerged }: { s: Styles; onMerged: () => void }) {
  const [list, setList] = useState<Identity[] | null>(null);
  const [available, setAvailable] = useState<Record<Provider, boolean>>({ vk: false, yandex: false });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mergeToken, setMergeToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ identities: Identity[]; available: Record<Provider, boolean> }>('/auth/account/identities');
      setList(r.identities);
      setAvailable(r.available);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
    // The provider sends the person back here with the result in the address; it is read once and taken out of the address.
    const q = new URLSearchParams(window.location.search);
    const linked = q.get('linked');
    const linkError = q.get('link_error');
    const merge = q.get('merge');
    if (linked === 'vk' || linked === 'yandex') setOk(`${SHORT[linked]} привязан: теперь входить можно и через него.`);
    if (linkError) setError(LINK_ERROR[linkError] ?? LINK_ERROR.oauth!);
    if (merge) {
      setMergeToken(merge);
      api<Preview>(`/auth/account/merge/${encodeURIComponent(merge)}`)
        .then(setPreview)
        .catch((e: unknown) => {
          setMergeToken(null);
          setError(errorText(e));
        });
    }
    if (linked || linkError || merge) window.history.replaceState(null, '', window.location.pathname);
  }, [load]);

  const start = async (provider: Provider) => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>(`/auth/account/identities/${provider}/link`, { method: 'POST', body: {} });
      window.location.assign(url);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const unlink = async (provider: Provider) => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api(`/auth/account/identities/${provider}`, { method: 'DELETE' });
      setOk(`${SHORT[provider]} отвязан.`);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const merge = async () => {
    if (!mergeToken) return;
    setBusy(true);
    setError(null);
    try {
      await api('/auth/account/merge', { method: 'POST', body: { token: mergeToken } });
      setOk('Аккаунты объединены: сборки, темы, заказы и тариф второго аккаунта теперь здесь.');
      setMergeToken(null);
      setPreview(null);
      await load();
      onMerged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const has = (p: Provider) => list?.some((i) => i.provider === p) ?? false;
  const many = (list?.length ?? 0) > 1;

  return (
    <section style={s.section} data-testid="login-methods">
      <p style={s.sectionTitle}>Способы входа</p>
      {error && <p role="alert" style={s.error}>{error}</p>}
      {ok && <p role="status" style={s.ok}>{ok}</p>}

      {preview && mergeToken && (
        <div style={s.confirmBox} data-testid="merge-offer">
          <p style={{ margin: '0 0 8px', fontWeight: 600 }}>
            Через этот {SHORT[preview.provider]} уже есть другой аккаунт — «{preview.other.displayName}»
          </p>
          <p style={{ ...s.notice, marginTop: 0 }}>
            Создан {date(preview.other.createdAt)}, в нём {preview.other.projects} {plural(preview.other.projects, 'сборка', 'сборки', 'сборок')} и {preview.other.themes}{' '}
            {plural(preview.other.themes, 'тема', 'темы', 'тем')}
            {preview.other.plan ? `, тариф «${preview.other.plan}»` : ''}.
          </p>
          <p style={s.notice}>
            Если объединить, всё это перейдёт в текущий аккаунт, а войти можно будет и через ВКонтакте, и через Яндекс ID. Второй аккаунт исчезнет. Отменить объединение нельзя.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button type="button" style={s.btn} disabled={busy} onClick={() => void merge()} data-testid="merge-confirm">
              Объединить аккаунты
            </button>
            <button
              type="button"
              style={s.btnSecondary}
              disabled={busy}
              onClick={() => {
                setMergeToken(null);
                setPreview(null);
              }}
            >
              Не объединять
            </button>
          </div>
        </div>
      )}

      {list === null && !error ? <p style={s.notice}>Загружаем…</p> : null}
      {list && (
        <ul style={s.list}>
          {list.map((i) => (
            <li key={`${i.provider}-${i.createdAt}`} style={s.li} data-testid={`login-method-${i.provider}`}>
              <span>
                {TITLE[i.provider] ?? i.provider} <span style={{ color: 'var(--muted)' }}>· с {date(i.createdAt)}</span>
              </span>
              {many && i.provider !== 'phone' ? (
                <button type="button" style={s.btnSecondary} disabled={busy} onClick={() => void unlink(i.provider as Provider)}>
                  Отвязать
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {list && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['vk', 'yandex'] as const)
            .filter((p) => available[p] && !has(p))
            .map((p) => (
              <button key={p} type="button" style={s.btn} disabled={busy} onClick={() => void start(p)} data-testid={`link-${p}`}>
                Привязать {SHORT[p]}
              </button>
            ))}
        </div>
      )}
      <p style={s.notice}>
        Привяжите второй способ входа, чтобы попадать в этот аккаунт и через ВКонтакте, и через Яндекс ID. Если через него у вас уже есть другой аккаунт, сайт предложит их
        объединить.
      </p>
    </section>
  );
}
