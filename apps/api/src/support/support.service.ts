import { HttpException, Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { AuditLogService } from '../auth/audit-log.service.js';
import { NotificationsService } from '../admin/notifications.service.js';
import { DB } from '../tokens.js';

const fail = (status: number, code: string, message: string): HttpException => new HttpException({ error: { code, message } }, status);

/** AD-13 · how long a question and a message may be, and how much one person may write in a day. */
export const QUESTION_MIN = 10;
export const QUESTION_MAX = 2000;
export const MESSAGE_MAX = 4000;
export const QUESTIONS_PER_DAY = 5;
export const MESSAGES_PER_DAY = 50;
const DAY = 86_400_000;

type Status = 'NEW' | 'ANSWERED' | 'CLOSED';
export interface QuestionView {
  id: string;
  text: string;
  status: Status;
  createdAt: Date;
  lastMessageAt: Date;
  /** Сообщений в переписке. */
  messages: number;
}
export interface AdminQuestionView extends QuestionView {
  userId: string;
  userName: string;
}
export interface MessageView {
  id: string;
  author: 'USER' | 'SUPPORT';
  text: string;
  createdAt: Date;
}
export interface ThreadView {
  question: QuestionView;
  messages: MessageView[];
}

const clean = (raw: unknown): string => (typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n').trim() : '');

/**
 * AD-13 · вопросы пользователей со страницы «Помощь». У каждого вопроса своя переписка (чат) с поддержкой: пользователь и
 * администратор пишут по очереди сколько нужно; каждый ответ поддержки приходит человеку уведомлением в кабинет.
 */
@Injectable()
export class SupportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly notices: NotificationsService,
    private readonly audit: AuditLogService,
  ) {}

  async ask(userId: string, raw: unknown, now: Date = new Date()): Promise<QuestionView> {
    const text = clean(raw);
    if (text.length < QUESTION_MIN || text.length > QUESTION_MAX) throw fail(400, 'INVALID_INPUT', `Напишите вопрос — от ${QUESTION_MIN} до ${QUESTION_MAX} знаков.`);
    const [today] = await this.db
      .select({ n: count() })
      .from(schema.supportQuestions)
      .where(and(eq(schema.supportQuestions.userId, userId), gt(schema.supportQuestions.createdAt, new Date(now.getTime() - DAY))));
    if ((today?.n ?? 0) >= QUESTIONS_PER_DAY) throw fail(429, 'TOO_MANY_QUESTIONS', `За сутки можно задать не больше ${QUESTIONS_PER_DAY} новых вопросов. Продолжите переписку в уже заданном — ответ придёт в кабинет.`);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(schema.supportQuestions).values({ userId, text, lastMessageAt: now }).returning();
      await tx.insert(schema.supportMessages).values({ questionId: row!.id, author: 'USER', authorId: userId, text, createdAt: now });
      return this.view(row!, 1);
    });
  }

  async mine(userId: string): Promise<QuestionView[]> {
    const rows = await this.db.select().from(schema.supportQuestions).where(eq(schema.supportQuestions.userId, userId)).orderBy(desc(schema.supportQuestions.lastMessageAt)).limit(50);
    const counts = await this.counts(rows.map((r) => r.id));
    return rows.map((r) => this.view(r, counts.get(r.id) ?? 0));
  }

  /** The chat of one question — only the person who asked it sees it (anyone else gets «не найдено»). */
  async thread(userId: string | null, id: string): Promise<ThreadView> {
    const [row] = await this.db.select().from(schema.supportQuestions).where(userId ? and(eq(schema.supportQuestions.id, id), eq(schema.supportQuestions.userId, userId)) : eq(schema.supportQuestions.id, id));
    if (!row) throw fail(404, 'NOT_FOUND', 'Такого вопроса нет.');
    const messages = await this.db
      .select({ id: schema.supportMessages.id, author: schema.supportMessages.author, text: schema.supportMessages.text, createdAt: schema.supportMessages.createdAt })
      .from(schema.supportMessages)
      .where(eq(schema.supportMessages.questionId, id))
      .orderBy(asc(schema.supportMessages.createdAt), asc(schema.supportMessages.id));
    return { question: this.view(row, messages.length), messages };
  }

  /** The person writes into the chat of their question: it waits for support again. A closed chat takes nothing. */
  async reply(userId: string, id: string, raw: unknown, now: Date = new Date()): Promise<ThreadView> {
    // The owner is checked first: a stranger learns nothing, not even what the text should be.
    const [row] = await this.db.select().from(schema.supportQuestions).where(and(eq(schema.supportQuestions.id, id), eq(schema.supportQuestions.userId, userId)));
    if (!row) throw fail(404, 'NOT_FOUND', 'Такого вопроса нет.');
    const text = clean(raw);
    if (text.length < 1 || text.length > MESSAGE_MAX) throw fail(400, 'INVALID_INPUT', `Напишите сообщение — до ${MESSAGE_MAX} знаков.`);
    if (row.status === 'CLOSED') throw fail(409, 'QUESTION_CLOSED', 'Переписка по этому вопросу закрыта. Задайте новый вопрос.');
    const [today] = await this.db
      .select({ n: count() })
      .from(schema.supportMessages)
      .innerJoin(schema.supportQuestions, eq(schema.supportQuestions.id, schema.supportMessages.questionId))
      .where(and(eq(schema.supportQuestions.userId, userId), eq(schema.supportMessages.author, 'USER'), gt(schema.supportMessages.createdAt, new Date(now.getTime() - DAY))));
    if ((today?.n ?? 0) >= MESSAGES_PER_DAY) throw fail(429, 'TOO_MANY_MESSAGES', 'Слишком много сообщений за сутки. Мы ответим на уже отправленные.');
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.supportMessages).values({ questionId: id, author: 'USER', authorId: userId, text, createdAt: now });
      await tx.update(schema.supportQuestions).set({ status: 'NEW', lastMessageAt: now }).where(eq(schema.supportQuestions.id, id));
    });
    return this.thread(userId, id);
  }

  async list(status: string | undefined): Promise<{ questions: AdminQuestionView[]; open: number }> {
    const all: Status[] = ['NEW', 'ANSWERED', 'CLOSED'];
    const one = all.find((s) => s === status);
    const statuses: Status[] = one ? [one] : status === 'all' ? all : ['NEW'];
    const rows = await this.db
      .select({ q: schema.supportQuestions, userName: schema.users.displayName })
      .from(schema.supportQuestions)
      .innerJoin(schema.users, eq(schema.users.id, schema.supportQuestions.userId))
      .where(inArray(schema.supportQuestions.status, statuses))
      .orderBy(desc(schema.supportQuestions.lastMessageAt))
      .limit(200);
    const counts = await this.counts(rows.map((r) => r.q.id));
    return { questions: rows.map((r) => ({ ...this.view(r.q, counts.get(r.q.id) ?? 0), userId: r.q.userId, userName: r.userName })), open: await this.openCount() };
  }

  /** AD-13 · сколько вопросов ждут ответа — для главной админки. */
  async openCount(): Promise<number> {
    const [open] = await this.db.select({ n: count() }).from(schema.supportQuestions).where(eq(schema.supportQuestions.status, 'NEW'));
    return open?.n ?? 0;
  }

  /** Support writes into the chat: the person gets a notice in the cabinet. A closed chat takes nothing. */
  async answer(actorId: string, id: string, raw: unknown, ip?: string, now: Date = new Date()): Promise<ThreadView> {
    const answer = clean(raw);
    if (answer.length < 2 || answer.length > MESSAGE_MAX) throw fail(400, 'INVALID_INPUT', `Напишите ответ — до ${MESSAGE_MAX} знаков.`);
    const [row] = await this.db.select().from(schema.supportQuestions).where(eq(schema.supportQuestions.id, id));
    if (!row) throw fail(404, 'NOT_FOUND', 'Такого вопроса нет.');
    if (row.status === 'CLOSED') throw fail(409, 'QUESTION_CLOSED', 'Переписка по этому вопросу закрыта.');
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.supportMessages).values({ questionId: id, author: 'SUPPORT', authorId: actorId, text: answer, createdAt: now });
      await tx.update(schema.supportQuestions).set({ status: 'ANSWERED', answeredById: actorId, answeredAt: now, lastMessageAt: now }).where(eq(schema.supportQuestions.id, id));
    });
    const topic = row.text.length > 120 ? `${row.text.slice(0, 120)}…` : row.text;
    await this.notices.notify({
      userId: row.userId,
      kind: `support:${row.id}:${String(now.getTime())}`,
      title: 'Ответ на ваш вопрос',
      body: `Вопрос: «${topic}»\n\nОтвет: ${answer}\n\nПродолжить переписку: «Помощь» → «Ваши вопросы».`,
    });
    await this.audit.log({ actorId, action: 'SUPPORT_ANSWERED', targetType: 'SUPPORT_QUESTION', targetId: row.id, ...(ip ? { ip } : {}) });
    return this.thread(null, id);
  }

  async close(actorId: string, id: string, ip?: string): Promise<QuestionView> {
    const [row] = await this.db
      .update(schema.supportQuestions)
      .set({ status: 'CLOSED', answeredById: actorId, answeredAt: new Date() })
      .where(and(eq(schema.supportQuestions.id, id), inArray(schema.supportQuestions.status, ['NEW', 'ANSWERED'])))
      .returning();
    if (!row) throw fail(409, 'QUESTION_CLOSED', 'Этот вопрос уже закрыт.');
    await this.audit.log({ actorId, action: 'SUPPORT_CLOSED', targetType: 'SUPPORT_QUESTION', targetId: row.id, ...(ip ? { ip } : {}) });
    return this.view(row, (await this.counts([row.id])).get(row.id) ?? 0);
  }

  private async counts(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: schema.supportMessages.questionId, n: count() })
      .from(schema.supportMessages)
      .where(inArray(schema.supportMessages.questionId, ids))
      .groupBy(schema.supportMessages.questionId);
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  private view(r: typeof schema.supportQuestions.$inferSelect, messages: number): QuestionView {
    return { id: r.id, text: r.text, status: r.status, createdAt: r.createdAt, lastMessageAt: r.lastMessageAt, messages };
  }
}
