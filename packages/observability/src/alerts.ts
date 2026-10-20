import { maskString } from './mask.js';

export type AlertSeverity = 'critical' | 'warning';

export interface Alert {
  key: string;
  title: string;
  details?: string;
  severity: AlertSeverity;
  at: Date;
  /** How many times the condition fired since the previous delivered alert with this key. */
  occurrences: number;
}

export interface AlertChannel {
  readonly name: string;
  send(alert: Alert): Promise<void>;
}

export interface AlertsLogger {
  error(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface AlertsOptions {
  channels: AlertChannel[];
  logger?: AlertsLogger;
  /** Same key is delivered at most once per window (default 10 minutes). */
  debounceMs?: number;
  now?: () => number;
}

/**
 * Alerts for the administrator (docs/02-ARCHITECTURE.md §9): 5xx spikes, failed jobs, full disk,
 * undelivered SMS, payment webhook errors. Delivery never throws; texts are masked.
 */
export class Alerts {
  private readonly lastSent = new Map<string, number>();
  private readonly suppressed = new Map<string, number>();
  private readonly windows = new Map<string, number[]>();
  private readonly debounceMs: number;
  private readonly now: () => number;

  constructor(private readonly options: AlertsOptions) {
    this.debounceMs = options.debounceMs ?? 10 * 60_000;
    this.now = options.now ?? Date.now;
  }

  /** Sends an alert unless the same key was sent within the debounce window. Returns true if sent. */
  async raise(key: string, title: string, details?: string, severity: AlertSeverity = 'warning'): Promise<boolean> {
    const t = this.now();
    const last = this.lastSent.get(key);
    if (last !== undefined && t - last < this.debounceMs) {
      this.suppressed.set(key, (this.suppressed.get(key) ?? 0) + 1);
      return false;
    }
    this.lastSent.set(key, t);
    const occurrences = 1 + (this.suppressed.get(key) ?? 0);
    this.suppressed.delete(key);
    const alert: Alert = {
      key,
      title: maskString(title),
      details: details === undefined ? undefined : maskString(details),
      severity,
      at: new Date(t),
      occurrences,
    };
    this.options.logger?.error({ alert: { key, severity, occurrences } }, `Тревога: ${alert.title}`);
    await Promise.all(
      this.options.channels.map(async (ch) => {
        try {
          await ch.send(alert);
        } catch (e) {
          this.options.logger?.warn({ err: e, channel: ch.name, key }, 'Не удалось доставить тревогу');
        }
      }),
    );
    return true;
  }

  /**
   * Counts an event; raises an alert when at least `threshold` events happened within `windowMs`.
   * Example: 20 server errors in a minute → one alert, then silence for the debounce window.
   */
  async hit(
    key: string,
    rule: { threshold: number; windowMs: number },
    title: string,
    details?: string,
    severity: AlertSeverity = 'critical',
  ): Promise<boolean> {
    const t = this.now();
    const events = (this.windows.get(key) ?? []).filter((x) => t - x < rule.windowMs);
    events.push(t);
    this.windows.set(key, events);
    if (events.length < rule.threshold) return false;
    this.windows.set(key, []);
    return this.raise(key, title, details ?? `${events.length} раз за ${Math.round(rule.windowMs / 1000)} с`, severity);
  }
}

const formatText = (a: Alert): string =>
  [
    `${a.severity === 'critical' ? '🔴' : '🟠'} Блокум: ${a.title}`,
    a.details,
    a.occurrences > 1 ? `Повторов с прошлой тревоги: ${a.occurrences}` : undefined,
    a.at.toISOString(),
  ]
    .filter(Boolean)
    .join('\n');

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

/** Administrator's Telegram bot (optional, docs/00-OWNER-DECISIONS.md решение 13). Texts contain no personal data. */
export class TelegramChannel implements AlertChannel {
  readonly name = 'telegram';
  constructor(
    private readonly token: string,
    private readonly chatId: string,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async send(alert: Alert): Promise<void> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: this.chatId, text: formatText(alert), disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`Telegram ответил ${res.status}`);
  }
}

export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

/** E-mail to the administrator through the platform mailer (provider is chosen by the owner). */
export class EmailChannel implements AlertChannel {
  readonly name = 'email';
  constructor(
    private readonly mailer: Mailer,
    private readonly to: string,
  ) {}

  async send(alert: Alert): Promise<void> {
    await this.mailer.send({ to: this.to, subject: `Блокум: ${alert.title}`, text: formatText(alert) });
  }
}

/** Builds alerts from environment: Telegram if both bot settings are set, e-mail if a mailer and address exist. */
export function createAlertsFromEnv(
  env: NodeJS.ProcessEnv,
  deps: { logger?: AlertsLogger; mailer?: Mailer; fetchFn?: FetchLike; now?: () => number } = {},
): Alerts {
  const channels: AlertChannel[] = [];
  if (env.TELEGRAM_ALERT_BOT_TOKEN && env.TELEGRAM_ALERT_CHAT_ID) {
    channels.push(new TelegramChannel(env.TELEGRAM_ALERT_BOT_TOKEN, env.TELEGRAM_ALERT_CHAT_ID, deps.fetchFn));
  }
  if (env.ALERT_EMAIL && deps.mailer) channels.push(new EmailChannel(deps.mailer, env.ALERT_EMAIL));
  return new Alerts({ channels, logger: deps.logger, now: deps.now });
}
