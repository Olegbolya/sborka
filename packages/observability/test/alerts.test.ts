import { describe, expect, it, vi } from 'vitest';
import { type Alert, type AlertChannel, Alerts, EmailChannel, TelegramChannel, createAlertsFromEnv } from '../src/index.js';

const collector = () => {
  const sent: Alert[] = [];
  const ch: AlertChannel = { name: 'test', send: (a) => (sent.push(a), Promise.resolve()) };
  return { sent, ch };
};

describe('тревоги', () => {
  it('20 ошибок 5xx за минуту — ровно одна тревога (антидребезг)', async () => {
    let t = 0;
    const { sent, ch } = collector();
    const alerts = new Alerts({ channels: [ch], now: () => t });
    const rule = { threshold: 20, windowMs: 60_000 };
    for (let i = 0; i < 19; i++) {
      t += 1000;
      expect(await alerts.hit('http_5xx', rule, 'Всплеск ошибок 5xx')).toBe(false);
    }
    t += 1000;
    expect(await alerts.hit('http_5xx', rule, 'Всплеск ошибок 5xx')).toBe(true);
    for (let i = 0; i < 40; i++) {
      t += 500;
      await alerts.hit('http_5xx', rule, 'Всплеск ошибок 5xx');
    }
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ key: 'http_5xx', severity: 'critical' });
    expect(sent[0]?.details).toContain('20 раз за 60 с');
  });

  it('19 ошибок, растянутых на 2 минуты, тревогу не вызывают', async () => {
    let t = 0;
    const { sent, ch } = collector();
    const alerts = new Alerts({ channels: [ch], now: () => t });
    for (let i = 0; i < 40; i++) {
      t += 7000;
      await alerts.hit('http_5xx', { threshold: 20, windowMs: 60_000 }, 'x');
    }
    expect(sent).toHaveLength(0);
  });

  it('после окна антидребезга тревога приходит снова с числом пропущенных повторов', async () => {
    let t = 0;
    const { sent, ch } = collector();
    const alerts = new Alerts({ channels: [ch], now: () => t, debounceMs: 600_000 });
    await alerts.raise('disk:/', 'Диск');
    t += 1000;
    await alerts.raise('disk:/', 'Диск');
    await alerts.raise('disk:/', 'Диск');
    t += 600_000;
    await alerts.raise('disk:/', 'Диск');
    expect(sent.map((a) => a.occurrences)).toEqual([1, 3]);
  });

  it('разные ключи не мешают друг другу', async () => {
    const { sent, ch } = collector();
    const alerts = new Alerts({ channels: [ch] });
    await alerts.raise('a', 'A');
    await alerts.raise('b', 'B');
    expect(sent).toHaveLength(2);
  });

  it('сбой канала не роняет приложение и логируется', async () => {
    const warn = vi.fn();
    const broken: AlertChannel = { name: 'broken', send: () => Promise.reject(new Error('нет связи')) };
    const { sent, ch } = collector();
    const alerts = new Alerts({ channels: [broken, ch], logger: { error: vi.fn(), warn } });
    await expect(alerts.raise('k', 'T')).resolves.toBe(true);
    expect(sent).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('текст тревоги маскируется', async () => {
    const { sent, ch } = collector();
    await new Alerts({ channels: [ch] }).raise('sms', 'СМС не доставлено на +79991234567', 'код 123456');
    expect(sent[0]?.title).not.toContain('9991234');
    expect(sent[0]?.details).toBe('код •••');
  });
});

describe('каналы', () => {
  it('Telegram отправляет сообщение боту администратора', async () => {
    const fetchFn = vi.fn(() => Promise.resolve({ ok: true, status: 200 }));
    const ch = new TelegramChannel('TOKEN', '42', fetchFn);
    await ch.send({ key: 'k', title: 'Тест', severity: 'critical', at: new Date(0), occurrences: 1 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
    expect(JSON.parse(init.body)).toMatchObject({ chat_id: '42' });
    expect((JSON.parse(init.body) as { text: string }).text).toContain('🔴 Блокум: Тест');
  });

  it('Telegram с ошибкой ответа бросает исключение (его ловит Alerts)', async () => {
    const ch = new TelegramChannel('T', '1', () => Promise.resolve({ ok: false, status: 401 }));
    await expect(ch.send({ key: 'k', title: 'x', severity: 'warning', at: new Date(), occurrences: 1 })).rejects.toThrow('401');
  });

  it('почта уходит администратору с темой', async () => {
    const send = vi.fn(() => Promise.resolve());
    await new EmailChannel({ send }, 'admin@example.ru').send({ key: 'k', title: 'Диск', severity: 'warning', at: new Date(0), occurrences: 2 });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@example.ru', subject: 'Блокум: Диск' }));
    expect((send.mock.calls[0] as unknown as [{ text: string }])[0].text).toContain('Повторов с прошлой тревоги: 2');
  });

  it('каналы из окружения: только настроенные', async () => {
    const fetchFn = vi.fn(() => Promise.resolve({ ok: true, status: 200 }));
    const mailer = { send: vi.fn(() => Promise.resolve()) };
    const both = createAlertsFromEnv(
      { TELEGRAM_ALERT_BOT_TOKEN: 't', TELEGRAM_ALERT_CHAT_ID: 'c', ALERT_EMAIL: 'a@b.ru' },
      { mailer, fetchFn },
    );
    await both.raise('k', 'x');
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(mailer.send).toHaveBeenCalledOnce();
    const none = createAlertsFromEnv({ TELEGRAM_ALERT_BOT_TOKEN: 't' }, { fetchFn });
    await none.raise('k', 'x');
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});
