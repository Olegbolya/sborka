import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq, gt, lt } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { fail } from '../admin/errors.js';
import { type ApiConfig } from '../config.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { API_CONFIG, DB, VK_FETCH } from '../tokens.js';

export type VkFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const API = 'https://api.vk.com/method';
const VERSION = '5.199';
const CODE_TTL_MS = 15 * 60_000;
const CODE_PATTERN = /^[a-f0-9]{24}$/;
const CODE_IN_TEXT = /\b([a-f0-9]{24})\b/;
/** Group dialogs have peer ids from 2 000 000 000: the community writes only to a person's own dialog. */
const CHAT_PEER_FROM = 2_000_000_000;
/** VK answers these when the community may no longer write to the person (blacklist, no permission, privacy settings). */
const GONE_ERRORS = new Set([900, 901, 902]);

export interface VkStatus {
  /** The community of the owner is connected (all five values are set). */
  configured: boolean;
  /** The plan of the creator allows messages in VK (04-TARIFFS: every paid plan — owner's decision 17.11). */
  allowed: boolean;
  linked: boolean;
  linkedAt: string | null;
}

interface VkMessage {
  from_id?: unknown;
  user_id?: unknown;
  peer_id?: unknown;
  text?: unknown;
  body?: unknown;
  ref?: unknown;
}

/**
 * D-07 · the VK community of the owner writes to creators about new passages (ADR-110). A creator opens the dialog by the link
 * `vk.me/<community>?ref=<word>`: VK returns `ref` in the message object of the `message_new` event of Callback API, and writing
 * first gives the community permission to answer. The word can also be sent as text. Sending is `messages.send` with the community key.
 */
@Injectable()
export class VkService {
  private readonly fetchFn: VkFetch;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Optional() private readonly entitlements?: EntitlementsService,
    @Optional() @Inject(VK_FETCH) fetchFn?: VkFetch,
  ) {
    this.fetchFn = fetchFn ?? ((url, init) => fetch(url, init));
  }

  /** A method of VK API called with the community key; `error_code` of VK, or the answer. Never throws. */
  private async call(method: string, params: Record<string, string>): Promise<{ response?: unknown; error?: number }> {
    const vk = this.config.vk;
    if (!vk) return { error: 0 };
    try {
      const body = new URLSearchParams({ ...params, access_token: vk.token, v: VERSION }).toString();
      const res = await this.fetchFn(`${API}/${method}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
      if (!res.ok) return { error: res.status };
      const data = (await res.json()) as { response?: unknown; error?: { error_code?: unknown } };
      if (data.error) return { error: typeof data.error.error_code === 'number' ? data.error.error_code : -1 };
      return { response: data.response };
    } catch {
      return { error: -1 };
    }
  }

  async allowedFor(userId: string): Promise<boolean> {
    if (!this.entitlements) return true;
    // Every paid plan has instant messages; «Старт» has only the daily digest in the cabinet.
    if ((await this.entitlements.limitsOf(userId)).notifications !== 'daily') return true;
    // «Праздник» is a pass for one project, not a plan of the person: it counts too while it is valid.
    return this.entitlements.hasPass(userId);
  }

  async status(userId: string): Promise<VkStatus> {
    const [link] = await this.db.select({ linkedAt: schema.vkLinks.linkedAt }).from(schema.vkLinks).where(eq(schema.vkLinks.userId, userId));
    return { configured: Boolean(this.config.vk), allowed: await this.allowedFor(userId), linked: Boolean(link), linkedAt: link?.linkedAt.toISOString() ?? null };
  }

  /** The link to the community dialog with a one-time word, and the word itself (if the link opens a dialog without it). */
  async startLink(userId: string): Promise<{ url: string; code: string; expiresAt: string }> {
    const vk = this.config.vk;
    if (!vk) throw fail(503, 'VK_OFF', 'Сообщения во ВКонтакте ещё не подключены.');
    if (!(await this.allowedFor(userId))) throw fail(402, 'PLAN_REQUIRED', 'Сообщения во ВКонтакте есть на платных тарифах.');
    const code = randomBytes(12).toString('hex');
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await this.db.delete(schema.vkLinkCodes).where(lt(schema.vkLinkCodes.expiresAt, new Date()));
    await this.db.delete(schema.vkLinkCodes).where(eq(schema.vkLinkCodes.userId, userId));
    await this.db.insert(schema.vkLinkCodes).values({ code, userId, expiresAt });
    return { url: `https://vk.me/${vk.screenName}?ref=${code}`, code, expiresAt: expiresAt.toISOString() };
  }

  async unlink(userId: string): Promise<void> {
    await this.db.delete(schema.vkLinks).where(eq(schema.vkLinks.userId, userId));
    await this.db.delete(schema.vkLinkCodes).where(eq(schema.vkLinkCodes.userId, userId));
  }

  private same(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }

  /**
   * One event of Callback API; returns the text to answer VK with: the confirmation string for `confirmation` of our community,
   * «ok» for everything else (VK repeats an event that is not answered «ok»). An event without our secret is ignored.
   */
  async handleEvent(event: unknown): Promise<string> {
    const vk = this.config.vk;
    const e = (event ?? {}) as { type?: unknown; group_id?: unknown; secret?: unknown; object?: unknown };
    if (!vk || e.group_id !== vk.groupId) return 'ok';
    if (e.type === 'confirmation') return vk.confirmation;
    if (typeof e.secret !== 'string' || !this.same(e.secret, vk.secret)) return 'ok';
    if (e.type === 'message_deny') {
      const userId = (e.object as { user_id?: unknown } | null)?.user_id;
      if (typeof userId === 'number') await this.db.delete(schema.vkLinks).where(eq(schema.vkLinks.peerId, String(userId)));
      return 'ok';
    }
    if (e.type === 'message_new') await this.onMessage(e.object).catch(() => undefined);
    return 'ok';
  }

  /** A message to the community: the word links the dialog, «стоп» unlinks it, anything else gets a short hint. */
  private async onMessage(object: unknown): Promise<void> {
    const o = (object ?? {}) as { message?: VkMessage } & VkMessage;
    const m: VkMessage = o.message ?? o;
    const from = typeof m.from_id === 'number' ? m.from_id : m.user_id;
    const peer = typeof m.peer_id === 'number' ? m.peer_id : from;
    if (typeof from !== 'number' || from <= 0 || typeof peer !== 'number' || peer >= CHAT_PEER_FROM) return;
    const person = String(from);
    const text = (typeof m.text === 'string' ? m.text : typeof m.body === 'string' ? m.body : '').trim();
    const code = typeof m.ref === 'string' && CODE_PATTERN.test(m.ref) ? m.ref : (CODE_IN_TEXT.exec(text.toLowerCase())?.[1] ?? null);
    if (code) {
      const [row] = await this.db.select().from(schema.vkLinkCodes).where(and(eq(schema.vkLinkCodes.code, code), gt(schema.vkLinkCodes.expiresAt, new Date())));
      if (!row) {
        await this.say(person, 'Ссылка устарела. Откройте «Настройки» в Блоккере и нажмите «Подключить ВКонтакте» ещё раз.');
        return;
      }
      await this.db.delete(schema.vkLinkCodes).where(eq(schema.vkLinkCodes.code, code));
      await this.db.insert(schema.vkLinks).values({ userId: row.userId, peerId: person, linkedAt: new Date() }).onConflictDoUpdate({ target: schema.vkLinks.userId, set: { peerId: person, linkedAt: new Date() } });
      await this.say(person, 'Готово! Сюда будут приходить сообщения о новых прохождениях ваших сборок. Отключить — напишите «стоп».');
      return;
    }
    if (/^\/?(стоп|stop)$/i.test(text)) {
      await this.db.delete(schema.vkLinks).where(eq(schema.vkLinks.peerId, person));
      await this.say(person, 'Отключено. Подключить снова можно в «Настройках» на сайте Блоккера.');
      return;
    }
    await this.say(person, 'Это сообщество Блоккера: оно присылает сообщения о новых прохождениях ваших сборок. Подключается в «Настройках» на сайте.');
  }

  private async say(peerId: string, text: string): Promise<{ error?: number }> {
    return this.call('messages.send', { peer_id: peerId, random_id: String(randomInt(1, 2 ** 31 - 1)), message: text.slice(0, 4000), dont_parse_links: '1' });
  }

  /** A message to the creator, when the community is on, the plan allows it and a dialog is linked. Never throws: VK is an extra. */
  async sendToUser(userId: string, text: string): Promise<boolean> {
    if (!this.config.vk) return false;
    try {
      const [link] = await this.db.select({ peerId: schema.vkLinks.peerId }).from(schema.vkLinks).where(eq(schema.vkLinks.userId, userId));
      if (!link || !(await this.allowedFor(userId))) return false;
      const res = await this.say(link.peerId, text);
      // The person forbade messages, blocked the community or closed them in privacy settings: the link is of no use any more.
      if (res.error !== undefined && GONE_ERRORS.has(res.error)) await this.db.delete(schema.vkLinks).where(eq(schema.vkLinks.userId, userId));
      return res.error === undefined;
    } catch {
      return false;
    }
  }
}
