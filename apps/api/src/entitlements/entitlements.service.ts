import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, isNull, lte, ne, or } from 'drizzle-orm';
import { type Db, PLANS, schema } from '@blokum/db';
import { countRules, type ProjectDocument, walkBlocks } from '@blokum/schema';

export type PlanLimits = schema.PlanLimits;
import { DB } from '../tokens.js';

/** What a document uses that depends on the plan (04-TARIFFS §2): the rows that are checked when publishing. */
export interface PlanFeatureUse {
  premiumTransitions: boolean;
  mediaInserts: number;
  /** The most objects that move by themselves on one screen. */
  mostMoving: number;
  behaviors: Set<string>;
  ownPreview: boolean;
}

const PREMIUM_TRANSITIONS = new Set(['flip', 'blinds', 'particles', 'page', 'preset']);
const MOVING = new Set(['move', 'follow', 'flee', 'spawner']);

/**
 * Looks through the document for what the plan decides. The kinds are those of the schema: a transition is `transitionIn` of a screen
 * or `transition` of a branch or rule; a media insert is a transition of kind `media`, a rule action `mediaOverlay` or a case of `mediaByAnswer`.
 */
export function scanPlanFeatures(doc: Pick<ProjectDocument, 'screens' | 'rules'> & Partial<Pick<ProjectDocument, 'theme' | 'meta'>>): PlanFeatureUse {
  const use: PlanFeatureUse = { premiumTransitions: false, mediaInserts: 0, mostMoving: 0, behaviors: new Set(), ownPreview: Boolean(doc.meta?.ogImage) };
  const visit = (node: unknown, key: string): void => {
    if (Array.isArray(node)) {
      for (const x of node) visit(x, key);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if ((key === 'transitionIn' || key === 'transition') && typeof o.kind === 'string') {
      if (PREMIUM_TRANSITIONS.has(o.kind)) use.premiumTransitions = true;
      if (o.kind === 'media') use.mediaInserts += 1;
    }
    if (o.kind === 'mediaOverlay') use.mediaInserts += 1;
    if (key === 'mediaByAnswer' && Array.isArray(o.cases)) use.mediaInserts += o.cases.length;
    if (key === 'particles' && Array.isArray(o.images) && o.images.length > 0) use.premiumTransitions = true;
    for (const [k, v] of Object.entries(o)) visit(v, k);
  };
  visit(doc.rules, 'rules');
  visit(doc.theme?.tokens, 'tokens');
  for (const screen of doc.screens) {
    visit(screen, 'screen');
    let moving = 0;
    for (const block of walkBlocks(screen.blocks)) {
      let moves = false;
      for (const b of block.behaviors) {
        use.behaviors.add(b.kind);
        if (MOVING.has(b.kind)) moves = true;
      }
      if (moves) moving += 1;
    }
    use.mostMoving = Math.max(use.mostMoving, moving);
  }
  return use;
}

/** Тариф человека на момент `now` и его лимиты (04-TARIFFS §6). */
export interface Plan {
  code: string;
  title: string;
  sort: number;
  limits: PlanLimits;
}

/** Возможности «да / нет» из таблицы тарифов; число-лимиты читаются через `limits`. */
export type BooleanFeature = {
  [K in keyof PlanLimits]-?: PlanLimits[K] extends boolean ? K : never;
}[keyof PlanLimits];

const FREE_CODE = 'FREE';
const PASS_FEATURE = 'PASS';

/**
 * P7.1 · ЕДИНСТВЕННОЕ место, где решается, какой тариф у человека и что ему доступно. Все лимиты (файлы, хранилище, темы,
 * водяной знак, прохождения…) спрашивают тариф здесь. Источник цен и лимитов — таблица `plans`; если строки там нет
 * (пустая база), берутся данные из `PLANS` того же вида.
 *
 * Тариф человека — самая «старшая» действующая подписка (ACTIVE или TRIAL, срок которой не истёк), иначе «Старт».
 * «Праздник» — не подписка, а разовый пропуск на одну сборку: запись `entitlements` с функцией `PASS` и сроком; он поднимает
 * лимиты только этой сборки и только если у владельца тариф ниже.
 */
@Injectable()
export class EntitlementsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private async plan(code: string): Promise<Plan> {
    const [row] = await this.db.select().from(schema.plans).where(eq(schema.plans.code, code));
    if (row) return { code: row.code, title: row.title, sort: row.sort, limits: row.limits };
    const seed = PLANS.find((p) => p.code === code) ?? PLANS.find((p) => p.code === FREE_CODE)!;
    return { code: seed.code, title: seed.title, sort: seed.sort, limits: seed.limits };
  }

  /** Тариф человека: старшая из действующих подписок или «Старт». */
  async planOf(userId: string, now: Date = new Date()): Promise<Plan> {
    const subs = await this.db
      .select({ planCode: schema.subscriptions.planCode, sort: schema.plans.sort })
      .from(schema.subscriptions)
      .innerJoin(schema.plans, eq(schema.plans.code, schema.subscriptions.planCode))
      .where(
        and(
          eq(schema.subscriptions.userId, userId),
          or(eq(schema.subscriptions.status, 'ACTIVE'), eq(schema.subscriptions.status, 'TRIAL')),
          lte(schema.subscriptions.currentPeriodStart, now),
          gt(schema.subscriptions.currentPeriodEnd, now),
        ),
      );
    const best = subs.sort((a, b) => b.sort - a.sort)[0];
    return this.withExtras(await this.plan(best?.planCode ?? FREE_CODE), userId, now);
  }

  /**
   * P7.5 · extra purchases of the person (04-TARIFFS §3): +storage for a subscription for a month, +themes and +rules for «Старт»
   * for good. They are rows of `entitlements` without a project; the passages bought extra are spent in `play`, not added here.
   */
  private async withExtras(plan: Plan, userId: string, now: Date): Promise<Plan> {
    const rows = await this.db
      .select({ feature: schema.entitlements.feature, quantity: schema.entitlements.quantity })
      .from(schema.entitlements)
      .where(
        and(
          eq(schema.entitlements.userId, userId),
          isNull(schema.entitlements.projectId),
          inArray(schema.entitlements.feature, ['EXTRA_STORAGE', 'EXTRA_THEMES', 'EXTRA_RULES']),
          lte(schema.entitlements.validFrom, now),
          or(isNull(schema.entitlements.validTo), gt(schema.entitlements.validTo, now)),
        ),
      );
    if (rows.length === 0) return plan;
    const sum = (feature: string): number => rows.filter((r) => r.feature === feature).reduce((a, r) => a + (r.quantity ?? 0), 0);
    const limits = { ...plan.limits };
    if (plan.code === FREE_CODE) {
      if (limits.ownThemes !== null) limits.ownThemes += sum('EXTRA_THEMES');
      limits.rulesPerProject += sum('EXTRA_RULES');
    } else {
      limits.storageBytes += sum('EXTRA_STORAGE') * 1024 * 1024;
    }
    return { ...plan, limits };
  }

  /** Лимиты человека (без учёта пропусков на сборки). */
  async limitsOf(userId: string, now: Date = new Date()): Promise<PlanLimits> {
    return (await this.planOf(userId, now)).limits;
  }

  /** Есть ли у человека действующий пропуск «Праздник» хотя бы на одну его сборку (возможности пропуска — не только у сборки: свои шрифты, например). */
  async hasPass(userId: string, now: Date = new Date()): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.entitlements.id })
      .from(schema.entitlements)
      .where(and(eq(schema.entitlements.userId, userId), eq(schema.entitlements.feature, PASS_FEATURE), lte(schema.entitlements.validFrom, now), or(isNull(schema.entitlements.validTo), gt(schema.entitlements.validTo, now))))
      .limit(1);
    return Boolean(row);
  }

  /** Действующий пропуск «Праздник» на сборку (начало и конец), если он есть. */
  async passOf(projectId: string, now: Date = new Date()): Promise<{ from: Date; to: Date } | null> {
    const [row] = await this.db
      .select({ from: schema.entitlements.validFrom, to: schema.entitlements.validTo })
      .from(schema.entitlements)
      .where(
        and(
          eq(schema.entitlements.projectId, projectId),
          eq(schema.entitlements.feature, PASS_FEATURE),
          lte(schema.entitlements.validFrom, now),
          or(isNull(schema.entitlements.validTo), gt(schema.entitlements.validTo, now)),
        ),
      )
      // After a renewal or an extension there are several rows: the term ends with the latest one.
      .orderBy(desc(schema.entitlements.validTo))
      .limit(1);
    return row?.to ? { from: row.from, to: row.to } : null;
  }

  /** Лимиты сборки: тариф владельца, поднятый пропуском «Праздник», если пропуск действует и он выгоднее. */
  async limitsOfProject(ownerId: string, projectId: string, now: Date = new Date()): Promise<{ plan: Plan; pass: { from: Date; to: Date } | null }> {
    const owner = await this.planOf(ownerId, now);
    const pass = await this.passOf(projectId, now);
    if (!pass) return { plan: owner, pass: null };
    const passPlan = await this.plan('PASS');
    return passPlan.sort > owner.sort ? { plan: passPlan, pass } : { plan: owner, pass };
  }

  /**
   * D-21 · табло (`/b/{код}`) — на платных тарифах и на пропуске «Праздник»; на «Старте» его нет (решение о границе — за владельцем,
   * `04-TARIFFS.md`). Сборка берёт тариф владельца, поднятый пропуском.
   */
  async scoreboardAllowed(ownerId: string, projectId: string, now: Date = new Date()): Promise<boolean> {
    return (await this.limitsOfProject(ownerId, projectId, now)).plan.code !== FREE_CODE;
  }

  /** Включена ли возможность у человека. */
  async has(userId: string, feature: BooleanFeature, now: Date = new Date()): Promise<boolean> {
    return (await this.limitsOf(userId, now))[feature];
  }

  /**
   * Что мешает опубликовать сборку на тарифе владельца (04-TARIFFS §4): платная возможность работает в редакторе и предпросмотре,
   * а при публикации сервер называет, что именно надо включить. Пустой список — публиковать можно.
   */
  async publishViolations(
    ownerId: string,
    projectId: string,
    doc: Pick<ProjectDocument, 'screens' | 'rules'> & Partial<Pick<ProjectDocument, 'theme' | 'meta'>>,
    settings: { passwordHash?: string; scheduledOpenAt?: string | null; scheduledCloseAt?: string | null; singleAttempt?: boolean },
    now: Date = new Date(),
  ): Promise<Array<{ code: string; message: string }>> {
    const { plan, pass } = await this.limitsOfProject(ownerId, projectId, now);
    const l = plan.limits;
    const out: Array<{ code: string; message: string }> = [];
    const tail = pass ? 'Перейдите на подписку, чтобы снять ограничение.' : 'Включите «Праздник» для этой сборки или оформите подписку.';
    const add = (code: string, message: string): void => void out.push({ code, message: `${message} ${tail}` });

    if (l.publishedProjects !== null && !pass) {
      const [published] = await this.db
        .select({ n: count() })
        .from(schema.projects)
        .where(and(eq(schema.projects.ownerId, ownerId), eq(schema.projects.status, 'PUBLISHED'), ne(schema.projects.id, projectId), isNull(schema.projects.deletedAt)));
      if ((published?.n ?? 0) >= l.publishedProjects) add('LIMIT_PUBLISHED', `На тарифе «${plan.title}» можно держать опубликованными до ${l.publishedProjects} сборок.`);
    }
    if (doc.screens.length > l.screensPerProject) add('LIMIT_SCREENS', `На тарифе «${plan.title}» в сборке может быть до ${l.screensPerProject} экранов, сейчас ${doc.screens.length}.`);
    const rules = countRules(doc);
    if (rules > l.rulesPerProject) add('LIMIT_RULES', `На тарифе «${plan.title}» в сборке может быть до ${l.rulesPerProject} правил, сейчас ${rules}.`);
    let hasContacts = false;
    let hasAudio = false;
    for (const screen of doc.screens) {
      for (const block of walkBlocks(screen.blocks)) {
        if (block.type === 'contacts') hasContacts = true;
        if (block.type === 'audio') hasAudio = true;
      }
    }
    if (hasContacts && !l.contactsCollection) add('FEATURE_CONTACTS', `Сбор контактов участников недоступен на тарифе «${plan.title}».`);
    if (hasAudio && !l.audio) add('FEATURE_AUDIO', `Звук в сборке недоступен на тарифе «${plan.title}».`);
    const use = scanPlanFeatures(doc);
    if (use.premiumTransitions && !l.premiumTransitions) add('FEATURE_TRANSITIONS', `Переходы «переворот», «шторка», «в частицах», «страница», свои переходы и частицы из своих картинок недоступны на тарифе «${plan.title}».`);
    if (l.mediaTransitionsPerProject !== null && use.mediaInserts > l.mediaTransitionsPerProject) add('LIMIT_MEDIA_TRANSITIONS', `На тарифе «${plan.title}» в сборке может быть до ${l.mediaTransitionsPerProject} медиа-переходов и вставок, сейчас ${use.mediaInserts}.`);
    if (use.mostMoving > l.movingObjects) add('LIMIT_MOVING_OBJECTS', `На тарифе «${plan.title}» на экране может двигаться до ${l.movingObjects} объектов, сейчас ${use.mostMoving}.`);
    if (l.behaviors !== 'all') {
      const extra = [...use.behaviors].filter((k) => !(l.behaviors as string[]).includes(k));
      if (extra.length > 0) add('FEATURE_BEHAVIORS', `На тарифе «${plan.title}» доступны только поведения: перетаскивание, переворот, убегание.`);
    }
    if (use.ownPreview && !l.ownBranding) add('FEATURE_OWN_PREVIEW', `Своя картинка для превью ссылки недоступна на тарифе «${plan.title}» (снимок первого экрана делается сам).`);
    const hasAccess = Boolean(settings.passwordHash) || Boolean(settings.scheduledOpenAt) || Boolean(settings.scheduledCloseAt) || settings.singleAttempt === true;
    if (hasAccess && !l.accessControls) add('FEATURE_ACCESS', `Пароль, расписание и одна попытка с устройства недоступны на тарифе «${plan.title}».`);
    return out;
  }
}
