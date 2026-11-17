'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../../lib/api-browser';

interface Status {
  configured: boolean;
  allowed: boolean;
  linked: boolean;
  linkedAt: string | null;
}

const btn = { padding: '10px 20px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff' } as const;
const btnSecondary = { padding: '8px 16px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border, #ddd)', cursor: 'pointer', background: 'transparent' } as const;
const notice = { fontSize: 13, color: 'var(--muted)', marginTop: 8 } as const;

const dateOf = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};

/** D-07 · «Уведомления во ВКонтакте»: привязка диалога с сообществом Блоккера (платные тарифы, ADR-110). */
export function VkSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [link, setLink] = useState<{ url: string; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api<Status>('/account/vk'));
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While the link is open the dialog may be linked any moment: ask again every few seconds.
  useEffect(() => {
    if (!link || status?.linked) return;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [link, status?.linked, load]);

  const connect = async () => {
    setError(null);
    try {
      setLink(await api<{ url: string; code: string }>('/account/vk/link', { method: 'POST' }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const disconnect = async () => {
    setError(null);
    try {
      await api('/account/vk', { method: 'DELETE' });
      setLink(null);
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (!status) return error ? <p role="alert" style={{ ...notice, color: '#b91c1c' }}>{error}</p> : null;
  return (
    <div data-testid="vk-settings">
      {error && (
        <p role="alert" style={{ ...notice, color: '#b91c1c' }}>
          {error}
        </p>
      )}
      {!status.configured ? (
        <p style={notice} data-testid="vk-off">
          Сообщения во ВКонтакте ещё не подключены: о прохождениях пока сообщается только в кабинете.
        </p>
      ) : !status.allowed ? (
        <p style={notice} data-testid="vk-plan">
          Сообщения о новых прохождениях во ВКонтакте есть на платных тарифах. <a href="/tariffs">Посмотреть тарифы</a>
        </p>
      ) : status.linked ? (
        <>
          <p style={{ fontSize: 15, margin: '0 0 12px' }} data-testid="vk-linked">
            ВКонтакте подключён{status.linkedAt ? ` (с ${dateOf(status.linkedAt)})` : ''}. Сообщения о новых прохождениях приходят в диалог с сообществом Блоккера.
          </p>
          <button type="button" style={btnSecondary} onClick={() => void disconnect()} data-testid="vk-disconnect">
            Отключить
          </button>
        </>
      ) : link ? (
        <>
          <p style={{ fontSize: 15, margin: '0 0 12px' }}>
            Откройте диалог с сообществом Блоккера и отправьте любое сообщение — например, нажмите «Начать». Ссылка работает 15 минут.
          </p>
          <a href={link.url} target="_blank" rel="noopener noreferrer" style={{ ...btn, display: 'inline-block', textDecoration: 'none' }} data-testid="vk-open">
            Открыть ВКонтакте
          </a>
          <p style={notice}>
            Если диалог открылся, но подключение не произошло, отправьте сообществу этот код: <code data-testid="vk-code">{link.code}</code>
          </p>
          <p style={notice}>Как только сообщение дойдёт, здесь появится «ВКонтакте подключён».</p>
        </>
      ) : (
        <>
          <button type="button" style={btn} onClick={() => void connect()} data-testid="vk-connect">
            Подключить ВКонтакте
          </button>
          <p style={notice}>
            Сообщество пришлёт короткое сообщение: название сборки, сколько всего прохождений и ссылку на таблицу ответов. Сами ответы участников во ВКонтакте не уходят — их видно только в кабинете. Отключить можно в любой момент: кнопкой здесь или словом «стоп» в диалоге.
          </p>
        </>
      )}
    </div>
  );
}
