import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';
import { and, eq, gt, lt } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { fail } from '../admin/errors.js';
import { type ApiConfig } from '../config.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { API_CONFIG, DB, TELEGRAM_FETCH } from '../tokens.js';

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

const CODE_TTL_MS = 15 * 60_000;
const CODE_PATTERN = /^[a-f0-9]{24}$/;

export interface TelegramStatus {
  /** The bot of the owner is connected (token, name and secret are set). */
  configured: boolean;
  /** The plan of the creator allows messages in Telegram (04-TARIFFS: «Про» and above). */
  allowed: boolean;
  linked: boolean;
  linkedAt: string | null;
}

/**
 * D-07 · the Telegram bot: a creator on «Про» links a chat by following a link with a one-time word, and then hears about new
 * passages there. The calls follow the Bot API: `sendMessage` (chat_id, text) and `setWebhook` (url, secret_token); Telegram puts the secret
 * in the header `X-Telegram-Bot-Api-Secret-Token` of every update it sends.
 */
@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly fetchFn: FetchLike;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Optional() private readonly entitlements?: EntitlementsService,
    @Optional() @Inject(TELEGRAM_FETCH) fetchFn?: FetchLike,
  ) {
    this.fetchFn = fetchFn ?? ((url, init) => fetch(url, init));
  }

  /** In production Telegram is told where to send updates; a failure only means the bot does not answer until the next start. */
  onModuleInit(): void {
    const tg = this.config.telegram;
    if (!tg || process.env.NODE_ENV !== 'production') return;
    void this.call('setWebhook', { url: `${this.config.webUrl}/api/v1/telegram/webhook`, secret_token: tg.webhookSecret, allowed_updates: ['message'] }).catch(() => undefined);
  }

  private call(method: string, payload: Record<string, unknown>): Promise<{ ok: boolean; status: number }> {
    const tg = this.config.telegram;
    if (!tg) return Promise.resolve({ ok: false, status: 503 });
    return this.fetchFn(`https://api.telegram.org/bot${tg.token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  }

  async allowedFor(userId: string): Promise<boolean> {
    if (!this.entitlements) return true;
    return (await this.entitlements.limitsOf(userId)).notifications === 'instant_plus';
  }

  async status(userId: string): Promise<TelegramStatus> {
    const [link] = await this.db.select({ linkedAt: schema.telegramLinks.linkedAt }).from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId));
    return { configured: Boolean(this.config.telegram), allowed: await this.allowedFor(userId), linked: Boolean(link), linkedAt: link?.linkedAt.toISOString() ?? null };
  }

  /** A link the creator opens in Telegram: the bot receives `/start <word>` and learns whose chat this is. */
  async startLink(userId: string): Promise<{ url: string; expiresAt: string }> {
    const tg = this.config.telegram;
    if (!tg) throw fail(503, 'TELEGRAM_OFF', 'Бот для Телеграма ещё не подключён.');
    if (!(await this.allowedFor(userId))) throw fail(402, 'PLAN_REQUIRED', 'Сообщения в Телеграм есть на тарифе «Про».');
    const code = randomBytes(12).toString('hex');
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await this.db.delete(schema.telegramLinkCodes).where(lt(schema.telegramLinkCodes.expiresAt, new Date()));
    await this.db.delete(schema.telegramLinkCodes).where(eq(schema.telegramLinkCodes.userId, userId));
    await this.db.insert(schema.telegramLinkCodes).values({ code, userId, expiresAt });
    return { url: `https://t.me/${tg.botUsername}?start=${code}`, expiresAt: expiresAt.toISOString() };
  }

  async unlink(userId: string): Promise<void> {
    await this.db.delete(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId));
    await this.db.delete(schema.telegramLinkCodes).where(eq(schema.telegramLinkCodes.userId, userId));
  }

  /** The header Telegram sends equals the secret that was given to `setWebhook`. */
  secretMatches(header: string | undefined): boolean {
    const want = this.config.telegram?.webhookSecret;
    if (!want || !header) return false;
    const a = Buffer.from(header);
    const b = Buffer.from(want);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** An update from Telegram: `/start <word>` links the chat, `/stop` unlinks it. Anything else gets a short hint. Only private chats count. */
  async handleUpdate(update: unknown): Promise<void> {
    const message = (update as { message?: { text?: unknown; chat?: { id?: unknown; type?: unknown } } } | null)?.message;
    const text = typeof message?.text === 'string' ? message.text.trim() : '';
    const chatId = message?.chat?.id;
    if (!message || (typeof chatId !== 'number' && typeof chatId !== 'string') || message.chat?.type !== 'private') return;
    const chat = String(chatId);
    const [command, argument = ''] = text.split(/\s+/, 2);
    if (command === '/start' && CODE_PATTERN.test(argument)) {
      const [row] = await this.db.select().from(schema.telegramLinkCodes).where(and(eq(schema.telegramLinkCodes.code, argument), gt(schema.telegramLinkCodes.expiresAt, new Date())));
      if (!row) {
        await this.say(chat, 'Ссылка устарела. Откройте «Настройки» в Блоккере и нажмите «Подключить Telegram» ещё раз.');
        return;
      }
      await this.db.delete(schema.telegramLinkCodes).where(eq(schema.telegramLinkCodes.code, argument));
      await this.db.insert(schema.telegramLinks).values({ userId: row.userId, chatId: chat, linkedAt: new Date() }).onConflictDoUpdate({ target: schema.telegramLinks.userId, set: { chatId: chat, linkedAt: new Date() } });
      await this.say(chat, 'Готово! Сюда будут приходить сообщения о новых прохождениях ваших сборок. Отключить — команда /stop.');
      return;
    }
    if (command === '/stop') {
      await this.db.delete(schema.telegramLinks).where(eq(schema.telegramLinks.chatId, chat));
      await this.say(chat, 'Отключено. Подключить снова можно в «Настройках» на сайте.');
      return;
    }
    await this.say(chat, 'Это бот Блоккера: он присылает сообщения о новых прохождениях. Подключается в «Настройках» на сайте.');
  }

  private async say(chatId: string, text: string): Promise<void> {
    await this.call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true }).catch(() => undefined);
  }

  /** A message to the creator's chat, when the bot is on, the plan allows it and a chat is linked. Never throws: Telegram is an extra. */
  async sendToUser(userId: string, text: string): Promise<boolean> {
    if (!this.config.telegram) return false;
    try {
      const [link] = await this.db.select({ chatId: schema.telegramLinks.chatId }).from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId));
      if (!link || !(await this.allowedFor(userId))) return false;
      const res = await this.call('sendMessage', { chat_id: link.chatId, text: text.slice(0, 4000), disable_web_page_preview: true });
      // 403: the person stopped or deleted the bot — the link is of no use any more.
      if (res.status === 403) await this.db.delete(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId));
      return res.ok;
    } catch {
      return false;
    }
  }
}
