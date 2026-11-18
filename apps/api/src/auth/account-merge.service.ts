import { HttpException, Injectable, Inject } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { DB } from '../tokens.js';
import { AuditLogService } from './audit-log.service.js';
import { OAuthService, type OAuthProvider } from './oauth.service.js';

const fail = (status: number, code: string, message: string): HttpException => new HttpException({ error: { code, message } }, status);

const PROVIDER_TITLE: Record<OAuthProvider, string> = { vk: 'VK ID', yandex: 'Яндекс ID' };

export interface MergePreview {
  provider: OAuthProvider;
  other: { displayName: string; createdAt: Date; projects: number; themes: number; plan: string | null };
}

/**
 * A-06 · ADR-117 · joining two accounts of one person. The account the person is signed in to stays; everything of the other one
 * (its ways in, assemblies, themes, templates, elements, fonts, media, orders, subscriptions, passes, consents, notices) moves to it
 * in one transaction, and the other account is deleted. A staff, blocked, deleted or held account is never absorbed.
 */
@Injectable()
export class AccountMergeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly oauth: OAuthService,
    private readonly audit: AuditLogService,
  ) {}

  private async offer(token: unknown, userId: string): Promise<{ token: string; fromUserId: string; provider: OAuthProvider }> {
    const t = typeof token === 'string' ? token : '';
    const found = await this.oauth.mergeOffer(t, userId);
    if (!found) throw fail(404, 'MERGE_OFFER_NOT_FOUND', 'Предложение объединить аккаунты устарело. Привяжите способ входа ещё раз.');
    return { token: t, ...found };
  }

  /** Why the other account cannot be joined, in words for the person; `null` — it can. */
  private refusal(other: typeof schema.users.$inferSelect): string | null {
    if (other.role !== 'USER') return 'Этот аккаунт служебный (модератор или администратор) — его нельзя присоединить. Напишите в поддержку.';
    if (other.status === 'BLOCKED') return 'Этот аккаунт заблокирован — его нельзя присоединить.';
    if (other.status === 'DELETED') return 'Этот аккаунт удалён. Чтобы перенести его сборки, сначала восстановите его: войдите через этот способ входа и нажмите «Восстановить».';
    if (other.legalHold) return 'Этот аккаунт сейчас нельзя присоединить: по нему идёт проверка. Напишите в поддержку.';
    return null;
  }

  async preview(token: unknown, userId: string): Promise<MergePreview> {
    const { fromUserId, provider } = await this.offer(token, userId);
    const [other] = await this.db.select().from(schema.users).where(eq(schema.users.id, fromUserId));
    if (!other) throw fail(404, 'MERGE_OFFER_NOT_FOUND', 'Второго аккаунта уже нет. Привяжите способ входа ещё раз.');
    const why = this.refusal(other);
    if (why) throw fail(409, 'MERGE_NOT_ALLOWED', why);
    const [p] = await this.db.select({ n: sql<number>`count(*)::int` }).from(schema.projects).where(and(eq(schema.projects.ownerId, fromUserId), isNull(schema.projects.deletedAt)));
    const [th] = await this.db.select({ n: sql<number>`count(*)::int` }).from(schema.themes).where(eq(schema.themes.ownerId, fromUserId));
    const [sub] = await this.db
      .select({ title: schema.plans.title })
      .from(schema.subscriptions)
      .innerJoin(schema.plans, eq(schema.plans.code, schema.subscriptions.planCode))
      .where(and(eq(schema.subscriptions.userId, fromUserId), inArray(schema.subscriptions.status, ['ACTIVE', 'TRIAL']), gt(schema.subscriptions.currentPeriodEnd, new Date())))
      .limit(1);
    return { provider, other: { displayName: other.displayName, createdAt: other.createdAt, projects: p?.n ?? 0, themes: th?.n ?? 0, plan: sub?.title ?? null } };
  }

  async merge(token: unknown, userId: string, ip?: string): Promise<{ ok: true; provider: OAuthProvider }> {
    const offer = await this.offer(token, userId);
    const a = userId;
    const b = offer.fromUserId;
    if (a === b) throw fail(409, 'MERGE_NOT_ALLOWED', 'Это тот же аккаунт.');
    await this.db.transaction(async (tx) => {
      // Both rows are locked: a second merge or a deletion at the same moment waits for this one.
      const rows = await tx.execute<{ id: string }>(sql`select id from users where id in (${a}, ${b}) order by id for update`);
      if (rows.rows.length !== 2) throw fail(404, 'MERGE_OFFER_NOT_FOUND', 'Второго аккаунта уже нет. Привяжите способ входа ещё раз.');
      const [other] = await tx.select().from(schema.users).where(eq(schema.users.id, b));
      const [self] = await tx.select().from(schema.users).where(eq(schema.users.id, a));
      const why = this.refusal(other!);
      if (why) throw fail(409, 'MERGE_NOT_ALLOWED', why);
      if (self!.status !== 'ACTIVE') throw fail(409, 'MERGE_NOT_ALLOWED', 'Объединять можно только из действующего аккаунта.');

      await tx.execute(sql`update auth_identities set user_id = ${a} where user_id = ${b}`);
      for (const table of ['projects', 'themes', 'templates', 'saved_elements', 'fonts', 'media']) {
        await tx.execute(sql`update ${sql.identifier(table)} set owner_id = ${a} where owner_id = ${b}`);
      }
      await tx.execute(sql`update project_versions set created_by_id = ${a} where created_by_id = ${b}`);
      for (const table of ['orders', 'subscriptions', 'entitlements', 'notifications', 'appeals', 'passage_digest_queue']) {
        await tx.execute(sql`update ${sql.identifier(table)} set user_id = ${a} where user_id = ${b}`);
      }
      // Consents stay as given: the record says who agreed and when, now under the account that remains.
      await tx.execute(sql`update consent_records set subject_id = ${a} where subject_type = 'USER' and subject_id = ${b}`);
      // A promo code used by both stays used once (one person); the other use is dropped.
      await tx.execute(sql`update promo_redemptions set user_id = ${a} where user_id = ${b} and promo_id not in (select promo_id from promo_redemptions where user_id = ${a})`);
      await tx.execute(sql`delete from promo_redemptions where user_id = ${b}`);
      // The usage of a month is the sum of both: the limits of the plan count the person, not the account.
      await tx.execute(sql`insert into usage_monthly (user_id, month, completions, storage_bytes, sms_sent)
        select ${a}, month, completions, storage_bytes, sms_sent from usage_monthly where user_id = ${b}
        on conflict (user_id, month) do update set completions = usage_monthly.completions + excluded.completions,
          storage_bytes = usage_monthly.storage_bytes + excluded.storage_bytes, sms_sent = usage_monthly.sms_sent + excluded.sms_sent`);
      await tx.execute(sql`delete from usage_monthly where user_id = ${b}`);
      // VK messages: the remaining account keeps its own link; it takes the other one only if it has none.
      await tx.execute(sql`update vk_links set user_id = ${a} where user_id = ${b} and not exists (select 1 from vk_links where user_id = ${a})`);
      await tx.execute(sql`delete from vk_links where user_id = ${b}`);
      await tx.execute(sql`delete from vk_link_codes where user_id = ${b}`);
      // Contacts the remaining account lacks are taken from the other one (the phone is unique, so it is moved, not copied).
      const take: Partial<typeof schema.users.$inferInsert> = {};
      if (!self!.email && other!.email) Object.assign(take, { email: other!.email, emailVerifiedAt: other!.emailVerifiedAt });
      if (!self!.ageConfirmedAt && other!.ageConfirmedAt) take.ageConfirmedAt = other!.ageConfirmedAt;
      if (!self!.phoneE164 && other!.phoneE164) {
        await tx.update(schema.users).set({ phoneE164: null }).where(eq(schema.users.id, b));
        take.phoneE164 = other!.phoneE164;
      }
      if (Object.keys(take).length > 0) await tx.update(schema.users).set(take).where(eq(schema.users.id, a));
      // What is left of the other account (its sessions, codes, mail tokens) goes with it.
      await tx.delete(schema.users).where(eq(schema.users.id, b));
    });
    await this.oauth.dropMergeOffer(offer.token);
    await this.audit.log({ actorId: a, action: 'ACCOUNTS_MERGED', targetType: 'user', targetId: a, ...(ip ? { ip } : {}), meta: { from: b, provider: offer.provider, via: PROVIDER_TITLE[offer.provider] } });
    return { ok: true, provider: offer.provider };
  }
}
