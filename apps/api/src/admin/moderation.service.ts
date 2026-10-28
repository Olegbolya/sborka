import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { type Alerts } from '@blokum/observability';
import { type Db, schema } from '@blokum/db';
import {
  ACTIONS_BY_TARGET,
  APPEAL_SELF_REVIEW_HOURS,
  MODERATION_ACTIONS,
  MODERATION_ACTION_LABELS,
  MODERATION_TARGETS,
  type ModerationActionKind,
  type ModerationTargetKind,
  REPORT_SLA_HOURS,
  findModerationReason,
  findReportCategory,
  plainText,
  walkBlocks,
} from '@blokum/schema';
import { AuditLogService } from '../auth/audit-log.service.js';
import { type RequestUser } from '../auth/session.service.js';
import { ALERTS, DB } from '../tokens.js';
import { fail } from './errors.js';
import { NotificationsService } from './notifications.service.js';

const HOUR_MS = 3_600_000;
/** The author of the automatic decisions in the history. */
export const SYSTEM_ACTOR = 'system';
/** §4.2: this many independent complaints within an hour make a complaint urgent. */
const URGENT_REPORTS_PER_HOUR = 3;

export interface ActInput {
  targetType: unknown;
  targetId: unknown;
  action: unknown;
  reasonCode: unknown;
  note: unknown;
  reportId?: unknown;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** What a decision changed on its target: `RESTORE` puts these back. */
interface Previous {
  status?: string;
  moderationStatus?: string;
  closedReason?: string | null;
  mediaStatus?: string;
  userStatus?: string;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * AD-03 · decisions of the moderators (docs/06-TRUST-SAFETY.md §5): each one needs a reason code and a comment, changes the
 * target, is written to the history of actions and to the audit log, and reaches the owner as a notice.
 */
@Injectable()
export class ModerationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ALERTS) private readonly alerts: Alerts,
    private readonly audit: AuditLogService,
    private readonly notices: NotificationsService,
  ) {}

  // ── Queue and case ─────────────────────────────────────────────────────────

  async queue(opts: { status?: string; priority?: string } = {}, now = new Date()) {
    const open = opts.status !== 'closed';
    const rows = await this.db
      .select({
        id: schema.reports.id,
        priority: schema.reports.priority,
        category: schema.reports.category,
        status: schema.reports.status,
        createdAt: schema.reports.createdAt,
        slaDueAt: schema.reports.slaDueAt,
        resolvedAt: schema.reports.resolvedAt,
        assigneeId: schema.reports.assigneeId,
        projectId: schema.projects.id,
        projectTitle: schema.projects.title,
        projectStatus: schema.projects.status,
        ownerName: schema.users.displayName,
      })
      .from(schema.reports)
      .leftJoin(schema.projects, eq(schema.projects.id, schema.reports.projectId))
      .leftJoin(schema.users, eq(schema.users.id, schema.projects.ownerId))
      .where(
        and(
          open ? inArray(schema.reports.status, ['NEW', 'IN_REVIEW']) : inArray(schema.reports.status, ['RESOLVED', 'REJECTED']),
          opts.priority === 'P0' || opts.priority === 'P1' || opts.priority === 'P2' ? eq(schema.reports.priority, opts.priority) : undefined,
        ),
      )
      .orderBy(open ? asc(schema.reports.priority) : desc(schema.reports.resolvedAt), asc(schema.reports.slaDueAt))
      .limit(200);
    return rows.map((r) => ({
      ...r,
      categoryLabel: findReportCategory(r.category)?.label ?? r.category,
      remainingMs: r.slaDueAt.getTime() - now.getTime(),
      overdue: open && r.slaDueAt.getTime() < now.getTime(),
    }));
  }

  async counts(now = new Date()) {
    const rows = await this.db
      .select({ priority: schema.reports.priority, n: count() })
      .from(schema.reports)
      .where(inArray(schema.reports.status, ['NEW', 'IN_REVIEW']))
      .groupBy(schema.reports.priority);
    const [overdue] = await this.db
      .select({ n: count() })
      .from(schema.reports)
      .where(and(inArray(schema.reports.status, ['NEW', 'IN_REVIEW']), sql`${schema.reports.slaDueAt} < ${now}`));
    const [appeals] = await this.db.select({ n: count() }).from(schema.appeals).where(eq(schema.appeals.status, 'NEW'));
    const by = (p: string) => rows.find((r) => r.priority === p)?.n ?? 0;
    return { P0: by('P0'), P1: by('P1'), P2: by('P2'), overdue: overdue?.n ?? 0, appeals: appeals?.n ?? 0 };
  }

  async caseDetail(reportId: string, now = new Date()) {
    const [report] = await this.db.select().from(schema.reports).where(eq(schema.reports.id, reportId));
    if (!report) throw fail(404, 'NOT_FOUND', 'Жалоба не найдена');
    const category = findReportCategory(report.category);
    const project = report.projectId ? await this.projectCard(report.projectId) : null;
    const snapshot = report.snapshotVersionId ? await this.snapshot(report.snapshotVersionId) : null;
    const others = report.projectId
      ? await this.db
          .select({ id: schema.reports.id, category: schema.reports.category, priority: schema.reports.priority, status: schema.reports.status, createdAt: schema.reports.createdAt })
          .from(schema.reports)
          .where(and(eq(schema.reports.projectId, report.projectId), ne(schema.reports.id, report.id)))
          .orderBy(desc(schema.reports.createdAt))
          .limit(50)
      : [];
    const history = await this.history(project ? { projectId: project.id, ownerId: project.ownerId } : {});
    return {
      report: {
        id: report.id,
        category: report.category,
        categoryLabel: category?.label ?? report.category,
        priority: report.priority,
        status: report.status,
        text: report.text,
        reporterContact: report.reporterContact,
        createdAt: report.createdAt,
        slaDueAt: report.slaDueAt,
        remainingMs: report.slaDueAt.getTime() - now.getTime(),
        resolvedAt: report.resolvedAt,
        resolution: report.resolution,
        assigneeId: report.assigneeId,
      },
      project,
      snapshot,
      otherReports: others,
      history,
    };
  }

  private async projectCard(projectId: string) {
    const [p] = await this.db
      .select({
        id: schema.projects.id,
        title: schema.projects.title,
        slug: schema.projects.slug,
        status: schema.projects.status,
        moderationStatus: schema.projects.moderationStatus,
        closedReason: schema.projects.closedReason,
        legalHold: schema.projects.legalHold,
        ownerId: schema.projects.ownerId,
        ownerName: schema.users.displayName,
        ownerStatus: schema.users.status,
      })
      .from(schema.projects)
      .innerJoin(schema.users, eq(schema.users.id, schema.projects.ownerId))
      .where(eq(schema.projects.id, projectId));
    return p ?? null;
  }

  /** What the complaint was about as it was published: the texts of every screen (§4.1) — to read, not to render. */
  private async snapshot(versionId: string) {
    const [v] = await this.db.select({ document: schema.projectVersions.document }).from(schema.projectVersions).where(eq(schema.projectVersions.id, versionId));
    const doc = v?.document as { screens?: Array<{ name: string; blocks: Parameters<typeof walkBlocks>[0] }> } | undefined;
    if (!doc?.screens) return null;
    return {
      screens: doc.screens.map((s) => ({
        name: s.name,
        texts: [...walkBlocks(s.blocks)].flatMap((b) => (b.textLayer ? [plainText(b.textLayer)] : [])).filter((t) => t.trim() !== ''),
      })),
    };
  }

  async history(where: { projectId?: string; ownerId?: string; mediaId?: string }) {
    const targets = [
      where.projectId ? and(eq(schema.moderationActions.targetType, 'PROJECT'), eq(schema.moderationActions.targetId, where.projectId)) : undefined,
      where.ownerId ? and(eq(schema.moderationActions.targetType, 'USER'), eq(schema.moderationActions.targetId, where.ownerId)) : undefined,
      where.mediaId ? and(eq(schema.moderationActions.targetType, 'MEDIA'), eq(schema.moderationActions.targetId, where.mediaId)) : undefined,
    ].filter((c) => c !== undefined);
    if (targets.length === 0) return [];
    const rows = await this.db.select().from(schema.moderationActions).where(or(...targets)).orderBy(desc(schema.moderationActions.createdAt)).limit(100);
    return rows.map((a) => ({
      id: a.id,
      targetType: a.targetType,
      targetId: a.targetId,
      action: a.action,
      actionLabel: MODERATION_ACTION_LABELS[a.action],
      reasonCode: a.reasonCode,
      reasonLabel: findModerationReason(a.reasonCode)?.label ?? a.reasonCode,
      note: a.note,
      actorId: a.actorId,
      createdAt: a.createdAt,
    }));
  }

  async take(reportId: string, actor: RequestUser, ip?: string): Promise<void> {
    const rows = await this.db
      .update(schema.reports)
      .set({ status: 'IN_REVIEW', assigneeId: actor.id })
      .where(and(eq(schema.reports.id, reportId), eq(schema.reports.status, 'NEW')))
      .returning({ id: schema.reports.id });
    if (rows.length === 0) throw fail(409, 'NOT_NEW', 'Жалобу уже взяли в работу или закрыли.');
    await this.audit.log({ actorId: actor.id, action: 'REPORT_TAKEN', targetType: 'REPORT', targetId: reportId, ...(ip ? { ip } : {}) });
  }

  /** Closes a complaint without a decision about the target (the complaint did not hold). */
  async dismiss(reportId: string, actor: RequestUser, noteRaw: unknown, ip?: string): Promise<void> {
    const note = text(noteRaw);
    if (note.length < 3 || note.length > 2000) throw fail(422, 'NOTE_REQUIRED', 'Напишите комментарий — от 3 до 2000 знаков.');
    const [report] = await this.db.select().from(schema.reports).where(eq(schema.reports.id, reportId));
    if (!report) throw fail(404, 'NOT_FOUND', 'Жалоба не найдена');
    if (report.status === 'RESOLVED' || report.status === 'REJECTED') throw fail(409, 'CLOSED', 'Жалоба уже закрыта.');
    await this.db.update(schema.reports).set({ status: 'REJECTED', resolvedAt: new Date(), resolution: note, assigneeId: actor.id }).where(eq(schema.reports.id, reportId));
    await this.audit.log({ actorId: actor.id, action: 'REPORT_DISMISSED', targetType: 'REPORT', targetId: reportId, ...(ip ? { ip } : {}), meta: { note } });
    // A sweeping automatic takedown (§4.2) is undone when the complaint did not hold and nothing else closes the project.
    if (report.projectId) await this.liftAutomaticTakedown(report.projectId, actor);
  }

  private async liftAutomaticTakedown(projectId: string, actor: RequestUser): Promise<void> {
    const [project] = await this.db.select({ status: schema.projects.status }).from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project || project.status !== 'CLOSED') return;
    const [last] = await this.db
      .select()
      .from(schema.moderationActions)
      .where(and(eq(schema.moderationActions.targetType, 'PROJECT'), eq(schema.moderationActions.targetId, projectId), inArray(schema.moderationActions.action, ['UNPUBLISH', 'BLOCK_PROJECT', 'RESTORE'])))
      .orderBy(desc(schema.moderationActions.createdAt), desc(schema.moderationActions.id))
      .limit(1);
    if (!last || last.action !== 'UNPUBLISH' || last.actorId !== SYSTEM_ACTOR) return;
    const [open] = await this.db
      .select({ n: count() })
      .from(schema.reports)
      .where(and(eq(schema.reports.projectId, projectId), inArray(schema.reports.status, ['NEW', 'IN_REVIEW'])));
    if ((open?.n ?? 0) > 0) return;
    await this.act(actor, { targetType: 'PROJECT', targetId: projectId, action: 'RESTORE', reasonCode: 'MISTAKE', note: 'Жалоба не подтвердилась — автоматическое снятие отменено.' });
  }

  // ── Decisions ──────────────────────────────────────────────────────────────

  async act(actor: RequestUser | { id: string; role: 'SYSTEM' }, input: ActInput, ip?: string, now = new Date()): Promise<{ id: string }> {
    const targetType = text(input.targetType) as ModerationTargetKind;
    const action = text(input.action) as ModerationActionKind;
    const reasonCode = text(input.reasonCode);
    const note = text(input.note);
    if (!MODERATION_TARGETS.includes(targetType)) throw fail(422, 'TARGET', 'Не понятно, к чему применить решение.');
    if (!MODERATION_ACTIONS.includes(action) || !ACTIONS_BY_TARGET[targetType].includes(action)) throw fail(422, 'ACTION', 'Это решение к такому объекту не применяется.');
    const reason = findModerationReason(reasonCode);
    if (!reason) throw fail(422, 'REASON', 'Выберите причину из списка.');
    if (note.length < 3 || note.length > 2000) throw fail(422, 'NOTE_REQUIRED', 'Напишите комментарий — от 3 до 2000 знаков.');
    const targetId = text(input.targetId);
    const reportId = text(input.reportId) || null;
    if (reportId) {
      const [r] = await this.db.select({ id: schema.reports.id }).from(schema.reports).where(eq(schema.reports.id, reportId));
      if (!r) throw fail(404, 'NOT_FOUND', 'Жалоба не найдена');
    }

    const result = await this.db.transaction(async (tx) => {
      const change = await this.apply(tx, actor, targetType, targetId, action);
      const [row] = await tx
        .insert(schema.moderationActions)
        .values({ targetType, targetId, action, reasonCode, note, actorId: actor.id, reportId, details: { previous: change.previous ?? null }, createdAt: now })
        .returning({ id: schema.moderationActions.id });
      if (reportId) {
        await tx
          .update(schema.reports)
          .set({ status: 'RESOLVED', resolvedAt: now, resolution: `${MODERATION_ACTION_LABELS[action]} · ${reason.label}`, assigneeId: actor.role === 'SYSTEM' ? null : actor.id })
          .where(eq(schema.reports.id, reportId));
      }
      await tx.insert(schema.auditLog).values({
        actorId: actor.id,
        action: `MODERATION_${action}`,
        targetType,
        targetId,
        ipHash: null,
        meta: { actionId: row!.id, reasonCode, reportId, ...(ip ? { via: 'admin' } : {}) },
      });
      return { id: row!.id, change };
    });

    if (result.change.ownerId && action !== 'LEGAL_HOLD' && action !== 'RELEASE_HOLD') {
      await this.notices.notify({
        userId: result.change.ownerId,
        kind: `MODERATION_${action}`,
        title: this.noticeTitle(action, result.change.projectTitle),
        body: this.noticeBody(action, reason.message, note, reasonCode, result.change.projectTitle),
        projectId: result.change.projectId ?? null,
      });
    }
    return { id: result.id };
  }

  private noticeTitle(action: ModerationActionKind, project: string | null): string {
    const what = project ? `«${project}»` : 'вашего аккаунта';
    switch (action) {
      case 'WARN':
        return `Предупреждение по ${project ? `сборке ${what}` : 'аккаунту'}`;
      case 'UNPUBLISH':
        return `Сборка ${what} снята с публикации`;
      case 'BLOCK_PROJECT':
        return `Сборка ${what} заблокирована`;
      case 'BLOCK_MEDIA':
        return 'Файл заблокирован';
      case 'BLOCK_USER':
        return 'Аккаунт заблокирован';
      default:
        return project ? `Сборка ${what} восстановлена` : 'Доступ восстановлен';
    }
  }

  private noticeBody(action: ModerationActionKind, message: string, note: string, reasonCode: string, project: string | null): string {
    // Category A: the answer to a blocked account has no details (§5).
    if (action === 'BLOCK_USER' && reasonCode.startsWith('A')) return 'Аккаунт заблокирован за нарушение правил сервиса.';
    const parts = [message, `Комментарий модератора: ${note}`];
    if (action === 'UNPUBLISH') parts.push('Исправьте сборку и нажмите «Исправил — проверить снова» на странице сборки в кабинете.');
    if (action === 'BLOCK_PROJECT') parts.push('Решение можно обжаловать: откройте сборку в кабинете и нажмите «Обжаловать». Его пересмотрит другой модератор.');
    if (action === 'RESTORE' && project) parts.push('Сборка снова доступна.');
    return parts.join('\n\n');
  }

  /** Changes the target and returns what was there before (for `RESTORE`) and whom to tell. */
  private async apply(
    tx: Tx,
    actor: { id: string; role: string },
    targetType: ModerationTargetKind,
    targetId: string,
    action: ModerationActionKind,
  ): Promise<{ previous?: Previous; ownerId?: string; projectId?: string; projectTitle: string | null }> {
    if (targetType === 'PROJECT') {
      const [p] = await tx.select().from(schema.projects).where(and(eq(schema.projects.id, targetId), isNull(schema.projects.deletedAt)));
      if (!p) throw fail(404, 'NOT_FOUND', 'Сборка не найдена');
      const base = { ownerId: p.ownerId, projectId: p.id, projectTitle: p.title };
      // A decision on top of an earlier one that still stands (the automatic takedown, then a block) keeps the state from before
      // the first: undoing it, by `RESTORE` or an appeal, gives the project back as it was before any moderation.
      const before: Previous = (await this.standingPrevious(tx, 'PROJECT', p.id)) ?? { status: p.status, moderationStatus: p.moderationStatus, closedReason: p.closedReason };
      switch (action) {
        case 'WARN':
          return base;
        case 'UNPUBLISH': {
          if (p.status !== 'PUBLISHED') throw fail(409, 'NOT_PUBLISHED', 'Сборка не опубликована — снимать нечего.');
          await tx.update(schema.projects).set({ status: 'CLOSED', moderationStatus: 'FLAGGED', closedReason: 'Модерация' }).where(eq(schema.projects.id, p.id));
          return { ...base, previous: before };
        }
        case 'BLOCK_PROJECT': {
          if (p.status === 'BLOCKED') throw fail(409, 'ALREADY', 'Сборка уже заблокирована.');
          await tx.update(schema.projects).set({ status: 'BLOCKED', moderationStatus: 'BLOCKED', closedReason: 'Модерация' }).where(eq(schema.projects.id, p.id));
          return { ...base, previous: before };
        }
        case 'LEGAL_HOLD':
        case 'RELEASE_HOLD': {
          await tx.update(schema.projects).set({ legalHold: action === 'LEGAL_HOLD' }).where(eq(schema.projects.id, p.id));
          return base;
        }
        case 'RESTORE': {
          const prev = await this.lastRestorable(tx, 'PROJECT', p.id);
          await tx
            .update(schema.projects)
            .set({ status: (prev.status ?? 'DRAFT') as 'PUBLISHED', moderationStatus: (prev.moderationStatus ?? 'NONE') as 'NONE', closedReason: prev.closedReason ?? null })
            .where(eq(schema.projects.id, p.id));
          return base;
        }
        default:
          throw fail(422, 'ACTION', 'Это решение к сборке не применяется.');
      }
    }

    if (targetType === 'MEDIA') {
      const [m] = await tx.select({ id: schema.media.id, status: schema.media.status, ownerId: schema.media.ownerId }).from(schema.media).where(eq(schema.media.id, targetId));
      if (!m) throw fail(404, 'NOT_FOUND', 'Файл не найден');
      const base = { ownerId: m.ownerId ?? undefined, projectTitle: null };
      if (action === 'BLOCK_MEDIA') {
        if (m.status === 'BLOCKED') throw fail(409, 'ALREADY', 'Файл уже заблокирован.');
        await tx.update(schema.media).set({ status: 'BLOCKED' }).where(eq(schema.media.id, m.id));
        return { ...base, previous: { mediaStatus: m.status } };
      }
      const prev = await this.lastRestorable(tx, 'MEDIA', m.id);
      await tx.update(schema.media).set({ status: (prev.mediaStatus ?? 'READY') as 'READY' }).where(eq(schema.media.id, m.id));
      return base;
    }

    // USER
    const [u] = await tx.select({ id: schema.users.id, role: schema.users.role, status: schema.users.status }).from(schema.users).where(eq(schema.users.id, targetId));
    if (!u) throw fail(404, 'NOT_FOUND', 'Пользователь не найден');
    const base = { ownerId: u.id, projectTitle: null };
    switch (action) {
      case 'WARN':
        return base;
      case 'BLOCK_USER': {
        if (u.id === actor.id) throw fail(409, 'SELF', 'Себя заблокировать нельзя.');
        if (u.role === 'ADMIN' || (u.role === 'MODERATOR' && actor.role !== 'ADMIN')) throw fail(403, 'FORBIDDEN', 'Этого пользователя заблокировать нельзя.');
        if (u.status === 'BLOCKED') throw fail(409, 'ALREADY', 'Аккаунт уже заблокирован.');
        await tx.update(schema.users).set({ status: 'BLOCKED' }).where(eq(schema.users.id, u.id));
        await tx.update(schema.sessions).set({ revokedAt: new Date() }).where(and(eq(schema.sessions.userId, u.id), isNull(schema.sessions.revokedAt)));
        return { ...base, previous: { userStatus: u.status } };
      }
      case 'LEGAL_HOLD':
      case 'RELEASE_HOLD':
        await tx.update(schema.users).set({ legalHold: action === 'LEGAL_HOLD' }).where(eq(schema.users.id, u.id));
        return base;
      case 'RESTORE': {
        const prev = await this.lastRestorable(tx, 'USER', u.id);
        await tx.update(schema.users).set({ status: (prev.userStatus ?? 'ACTIVE') as 'ACTIVE' }).where(eq(schema.users.id, u.id));
        return base;
      }
      default:
        throw fail(422, 'ACTION', 'Это решение к пользователю не применяется.');
    }
  }

  /** What was there before the decision that still stands on the target; `null` when no decision stands. */
  private async standingPrevious(tx: Tx, targetType: ModerationTargetKind, targetId: string): Promise<Previous | null> {
    try {
      return await this.lastRestorable(tx, targetType, targetId);
    } catch {
      return null;
    }
  }

  /** The state before the latest decision on the target that can still be undone. */
  private async lastRestorable(tx: Tx, targetType: ModerationTargetKind, targetId: string): Promise<Previous> {
    const rows = await tx
      .select()
      .from(schema.moderationActions)
      .where(and(eq(schema.moderationActions.targetType, targetType), eq(schema.moderationActions.targetId, targetId), inArray(schema.moderationActions.action, ['UNPUBLISH', 'BLOCK_PROJECT', 'BLOCK_MEDIA', 'BLOCK_USER', 'RESTORE'])))
      .orderBy(desc(schema.moderationActions.createdAt), desc(schema.moderationActions.id))
      .limit(1);
    const last = rows[0];
    const previous = (last?.details as { previous?: Previous | null } | undefined)?.previous;
    if (!last || last.action === 'RESTORE' || !previous) throw fail(409, 'NOTHING_TO_RESTORE', 'Восстанавливать нечего: последнее решение уже отменено или ничего не меняло.');
    return previous;
  }

  // ── Automatic measures for complaints (§4.2) ───────────────────────────────

  /** Called when a complaint is accepted: heavy ones close the project at once, and the owner of the service is told. */
  async onReport(reportId: string, now = new Date()): Promise<void> {
    const [report] = await this.db.select().from(schema.reports).where(eq(schema.reports.id, reportId));
    if (!report?.projectId) return;
    let priority = report.priority;
    const [recent] = await this.db
      .select({ n: sql<number>`count(distinct ${schema.reports.reporterIpHash})` })
      .from(schema.reports)
      .where(and(eq(schema.reports.projectId, report.projectId), gte(schema.reports.createdAt, new Date(now.getTime() - HOUR_MS))));
    if (priority !== 'P0' && Number(recent?.n ?? 0) >= URGENT_REPORTS_PER_HOUR) {
      priority = 'P0';
      await this.db.update(schema.reports).set({ priority: 'P0', slaDueAt: new Date(now.getTime() + REPORT_SLA_HOURS.P0 * HOUR_MS) }).where(eq(schema.reports.id, report.id));
    }
    if (priority !== 'P0') return;
    const [project] = await this.db.select({ status: schema.projects.status, title: schema.projects.title }).from(schema.projects).where(eq(schema.projects.id, report.projectId));
    if (project?.status === 'PUBLISHED') {
      await this.act({ id: SYSTEM_ACTOR, role: 'SYSTEM' }, { targetType: 'PROJECT', targetId: report.projectId, action: 'UNPUBLISH', reasonCode: 'AUTO_P0', note: `Автоматически: жалоба ${report.category} (${report.priority === priority ? 'тяжёлая категория' : 'три независимые жалобы за час'}).` }, undefined, now);
    }
    await this.alerts.raise(`report-p0:${report.projectId}`, `Жалоба P0 на сборку «${project?.title ?? report.projectId}»`, `Категория ${report.category}. Очередь модерации: /admin/queue`, 'critical');
  }

  // ── Appeals ────────────────────────────────────────────────────────────────

  /** The project page of the creator: why it is closed and whether an appeal can be sent (§5). */
  async creatorView(userId: string, projectId: string) {
    const [p] = await this.db.select().from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId), isNull(schema.projects.deletedAt)));
    if (!p) throw fail(404, 'NOT_FOUND', 'Сборка не найдена');
    const moderated = p.status === 'BLOCKED' || (p.status === 'CLOSED' && p.moderationStatus === 'FLAGGED');
    const actions = await this.db
      .select()
      .from(schema.moderationActions)
      .where(and(eq(schema.moderationActions.targetType, 'PROJECT'), eq(schema.moderationActions.targetId, p.id), inArray(schema.moderationActions.action, ['WARN', 'UNPUBLISH', 'BLOCK_PROJECT', 'RESTORE'])))
      .orderBy(desc(schema.moderationActions.createdAt), desc(schema.moderationActions.id))
      .limit(20);
    const appeals = await this.db.select().from(schema.appeals).where(eq(schema.appeals.projectId, p.id)).orderBy(desc(schema.appeals.createdAt)).limit(5);
    const open = appeals.find((a) => a.status === 'NEW');
    const decision = actions.find((a) => a.action === 'UNPUBLISH' || a.action === 'BLOCK_PROJECT');
    return {
      moderated,
      status: p.status,
      reason: moderated ? p.closedReason : null,
      canAppeal: moderated && !open && !!decision && p.moderationStatus !== 'NONE',
      resubmit: p.status === 'CLOSED' && p.moderationStatus === 'FLAGGED',
      history: actions.map((a) => ({
        action: a.action,
        actionLabel: MODERATION_ACTION_LABELS[a.action],
        reason: findModerationReason(a.reasonCode)?.message ?? '',
        note: a.note,
        createdAt: a.createdAt,
      })),
      appeals: appeals.map((a) => ({ id: a.id, status: a.status, text: a.text, decisionNote: a.decisionNote, createdAt: a.createdAt, decidedAt: a.decidedAt })),
    };
  }

  async appeal(userId: string, projectId: string, textRaw: unknown, ip?: string): Promise<{ id: string }> {
    const body = text(textRaw);
    if (body.length < 10 || body.length > 2000) throw fail(422, 'APPEAL_TEXT', 'Опишите, почему решение стоит пересмотреть, — от 10 до 2000 знаков.');
    const view = await this.creatorView(userId, projectId);
    if (!view.moderated) throw fail(409, 'NOT_MODERATED', 'Эту сборку модераторы не закрывали.');
    if (!view.canAppeal) throw fail(409, 'APPEAL_OPEN', 'Обращение по этому решению уже отправлено — ждите ответа.');
    const [decision] = await this.db
      .select()
      .from(schema.moderationActions)
      .where(and(eq(schema.moderationActions.targetType, 'PROJECT'), eq(schema.moderationActions.targetId, projectId), inArray(schema.moderationActions.action, ['UNPUBLISH', 'BLOCK_PROJECT'])))
      .orderBy(desc(schema.moderationActions.createdAt), desc(schema.moderationActions.id))
      .limit(1);
    if (!decision) throw fail(409, 'NOT_MODERATED', 'Эту сборку модераторы не закрывали.');
    const [row] = await this.db.insert(schema.appeals).values({ projectId, userId, actionId: decision.id, text: body }).returning({ id: schema.appeals.id });
    await this.audit.log({ actorId: userId, action: 'APPEAL_CREATED', targetType: 'PROJECT', targetId: projectId, ...(ip ? { ip } : {}), meta: { appealId: row!.id, actionId: decision.id } });
    return { id: row!.id };
  }

  async appeals(status = 'NEW') {
    const rows = await this.db
      .select({
        id: schema.appeals.id,
        status: schema.appeals.status,
        text: schema.appeals.text,
        createdAt: schema.appeals.createdAt,
        decidedAt: schema.appeals.decidedAt,
        decisionNote: schema.appeals.decisionNote,
        reviewerId: schema.appeals.reviewerId,
        projectId: schema.projects.id,
        projectTitle: schema.projects.title,
        userId: schema.users.id,
        userName: schema.users.displayName,
        actionId: schema.moderationActions.id,
        action: schema.moderationActions.action,
        reasonCode: schema.moderationActions.reasonCode,
        note: schema.moderationActions.note,
        actorId: schema.moderationActions.actorId,
        actionAt: schema.moderationActions.createdAt,
      })
      .from(schema.appeals)
      .innerJoin(schema.users, eq(schema.users.id, schema.appeals.userId))
      .innerJoin(schema.moderationActions, eq(schema.moderationActions.id, schema.appeals.actionId))
      .leftJoin(schema.projects, eq(schema.projects.id, schema.appeals.projectId))
      .where(status === 'all' ? undefined : status === 'decided' ? ne(schema.appeals.status, 'NEW') : eq(schema.appeals.status, 'NEW'))
      .orderBy(asc(schema.appeals.createdAt))
      .limit(200);
    return rows.map((r) => ({ ...r, actionLabel: MODERATION_ACTION_LABELS[r.action], reasonLabel: findModerationReason(r.reasonCode)?.label ?? r.reasonCode }));
  }

  /** §5: another moderator decides; one who is alone decides again no earlier than 24 hours after their own decision. */
  async decideAppeal(reviewer: RequestUser, appealId: string, decisionRaw: unknown, noteRaw: unknown, ip?: string, now = new Date()): Promise<void> {
    const decision = text(decisionRaw);
    const note = text(noteRaw);
    if (decision !== 'GRANT' && decision !== 'DENY') throw fail(422, 'DECISION', 'Выберите решение: удовлетворить или отклонить.');
    if (note.length < 3 || note.length > 2000) throw fail(422, 'NOTE_REQUIRED', 'Напишите комментарий — от 3 до 2000 знаков.');
    const [a] = await this.db.select().from(schema.appeals).where(eq(schema.appeals.id, appealId));
    if (!a) throw fail(404, 'NOT_FOUND', 'Обращение не найдено');
    if (a.status !== 'NEW') throw fail(409, 'DECIDED', 'По этому обращению уже есть решение.');
    const [action] = await this.db.select().from(schema.moderationActions).where(eq(schema.moderationActions.id, a.actionId));
    if (action && action.actorId === reviewer.id && now.getTime() - action.createdAt.getTime() < APPEAL_SELF_REVIEW_HOURS * HOUR_MS) {
      throw fail(409, 'SAME_MODERATOR', 'Обращение должен рассмотреть другой модератор. Своё решение можно пересмотреть не раньше, чем через 24 часа.');
    }
    if (decision === 'GRANT' && a.projectId) {
      await this.act(reviewer, { targetType: 'PROJECT', targetId: a.projectId, action: 'RESTORE', reasonCode: 'APPEAL_GRANTED', note }, ip, now);
    }
    await this.db.update(schema.appeals).set({ status: decision === 'GRANT' ? 'GRANTED' : 'DENIED', reviewerId: reviewer.id, decisionNote: note, decidedAt: now }).where(eq(schema.appeals.id, a.id));
    await this.audit.log({ actorId: reviewer.id, action: decision === 'GRANT' ? 'APPEAL_GRANTED' : 'APPEAL_DENIED', targetType: 'APPEAL', targetId: a.id, ...(ip ? { ip } : {}), meta: { projectId: a.projectId } });
    if (decision === 'DENY') {
      await this.notices.notify({ userId: a.userId, kind: 'APPEAL_DENIED', title: 'Обращение рассмотрено: решение остаётся', body: `Мы пересмотрели решение и оставили его без изменений.\n\nКомментарий модератора: ${note}`, projectId: a.projectId });
    }
  }
}
