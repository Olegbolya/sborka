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

/** D-07 · «Уведомления в Telegram»: привязка чата с ботом Блоккера (тариф «Про»). */
export function TelegramSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api<Status>('/account/telegram'));
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While the link is open the chat may be linked any moment: ask again every few seconds.
  useEffect(() => {
    if (!url || status?.linked) return;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [url, status?.linked, load]);

  const connect = async () => {
    setError(null);
    try {
      const res = await api<{ url: string }>('/account/telegram/link', { method: 'POST' });
      setUrl(res.url);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const disconnect = async () => {
    setError(null);
    try {
      await api('/account/telegram', { method: 'DELETE' });
      setUrl(null);
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (!status) return error ? <p role="alert" style={{ ...notice, color: '#b91c1c' }}>{error}</p> : null;
  return (
    <div data-testid="telegram-settings">
      {error && (
        <p role="alert" style={{ ...notice, color: '#b91c1c' }}>
          {error}
        </p>
      )}
      {!status.configured ? (
        <p style={notice} data-testid="telegram-off">Бот для Телеграма ещё не подключён: сообщения о прохождениях пока приходят только в кабинет.</p>
      ) : !status.allowed ? (
        <p style={notice} data-testid="telegram-plan">
          Сообщения о новых прохождениях в Телеграм есть на тарифе «Про». <a href="/tariffs">Посмотреть тарифы</a>
        </p>
      ) : status.linked ? (
        <>
          <p style={{ fontSize: 15, margin: '0 0 12px' }} data-testid="telegram-linked">
            Телеграм подключён{status.linkedAt ? ` (с ${dateOf(status.linkedAt)})` : ''}. Сообщения о новых прохождениях приходят в чат с ботом.
          </p>
          <button type="button" style={btnSecondary} onClick={() => void disconnect()}>
            Отключить Телеграм
          </button>
        </>
      ) : url ? (
        <>
          <p style={{ fontSize: 15, margin: '0 0 12px' }}>
            Откройте бота и нажмите в Телеграме «Запустить». Ссылка работает 15 минут.
          </p>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ ...btn, display: 'inline-block', textDecoration: 'none' }} data-testid="telegram-open">
            Открыть Телеграм
          </a>
          <p style={notice}>Как только вы нажмёте «Запустить», здесь появится «Телеграм подключён».</p>
        </>
      ) : (
        <>
          <button type="button" style={btn} onClick={() => void connect()} data-testid="telegram-connect">
            Подключить Телеграм
          </button>
          <p style={notice}>Бот пришлёт в чат короткое сообщение: название сборки, сколько всего прохождений и ссылку на таблицу ответов. Сами ответы участников в Телеграм не уходят — их видно только в кабинете. Отключить можно в любой момент.</p>
        </>
      )}
    </div>
  );
}
