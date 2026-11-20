import { HttpException, Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { AuditLogService } from '../auth/audit-log.service.js';
import { NotificationsService } from '../admin/notifications.service.js';
import { DB } from '../tokens.js';

const fail = (status: number, code: string, message: string): HttpException => new HttpException({ error: { code, message } }, status);

/** AD-13 · how long a question and an answer may be, and how many questions one person may send in a day. */
export const QUESTION_MIN = 10;
export const QUESTION_MAX = 2000;
export const ANSWER_MAX = 4000;
export const QUESTIONS_PER_DAY = 5;
const DAY = 86_400_000;

export interface QuestionView {
  id: string;
  text: string;
  status: 'NEW' | 'ANSWERED' | 'CLOSED';
  answer: string | null;
  createdAt: Date;
  answeredAt: Date | null;
}
export interface AdminQuestionView extends QuestionView {
  userId: string;
  userName: string;
}

const clean = (raw: unknown): string => (typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n').trim() : '');

/**
 * AD-13 · вопросы пользователей со страницы «Помощь». Вопрос приходит в админку; ответ администратора уходит человеку
 * уведомлением в кабинет (и письмом, если почта подтверждена) и виден под формой на странице «Помощь».
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
    if ((today?.n ?? 0) >= QUESTIONS_PER_DAY) throw fail(429, 'TOO_MANY_QUESTIONS', `За сутки можно отправить не больше ${QUESTIONS_PER_DAY} вопросов. Мы ответим на уже отправленные — ответ придёт в кабинет.`);
    const [row] = await this.db.insert(schema.supportQuestions).values({ userId, text }).returning();
    return this.view(row!);
  }

  async mine(userId: string): Promise<QuestionView[]> {
    const rows = await this.db.select().from(schema.supportQuestions).where(eq(schema.supportQuestions.userId, userId)).orderBy(desc(schema.supportQuestions.createdAt)).limit(50);
    return rows.map((r) => this.view(r));
  }

  async list(status: string | undefined): Promise<{ questions: AdminQuestionView[]; open: number }> {
    const all: Array<QuestionView['status']> = ['NEW', 'ANSWERED', 'CLOSED'];
    const one = all.find((s) => s === status);
    const statuses: Array<QuestionView['status']> = one ? [one] : status === 'all' ? all : ['NEW'];
    const rows = await this.db
      .select({ q: schema.supportQuestions, userName: schema.users.displayName })
      .from(schema.supportQuestions)
      .innerJoin(schema.users, eq(schema.users.id, schema.supportQuestions.userId))
      .where(inArray(schema.supportQuestions.status, statuses))
      .orderBy(desc(schema.supportQuestions.createdAt))
      .limit(200);
    return { questions: rows.map((r) => ({ ...this.view(r.q), userId: r.q.userId, userName: r.userName })), open: await this.openCount() };
  }

  /** AD-13 · сколько вопросов ждут ответа — для главной админки. */
  async openCount(): Promise<number> {
    const [open] = await this.db.select({ n: count() }).from(schema.supportQuestions).where(eq(schema.supportQuestions.status, 'NEW'));
    return open?.n ?? 0;
  }

  async answer(actorId: string, id: string, raw: unknown, ip?: string): Promise<QuestionView> {
    const answer = clean(raw);
    if (answer.length < 2 || answer.length > ANSWER_MAX) throw fail(400, 'INVALID_INPUT', `Напишите ответ — до ${ANSWER_MAX} знаков.`);
    const [row] = await this.db
      .update(schema.supportQuestions)
      .set({ status: 'ANSWERED', answer, answeredById: actorId, answeredAt: new Date() })
      .where(and(eq(schema.supportQuestions.id, id), eq(schema.supportQuestions.status, 'NEW')))
      .returning();
    if (!row) throw fail(409, 'QUESTION_CLOSED', 'На этот вопрос уже ответили или он закрыт.');
    const quote = row.text.length > 300 ? `${row.text.slice(0, 300)}…` : row.text;
    await this.notices.notify({ userId: row.userId, kind: `support:${row.id}`, title: 'Ответ на ваш вопрос', body: `Вы спросили: «${quote}»\n\nОтвет: ${answer}` });
    await this.audit.log({ actorId, action: 'SUPPORT_ANSWERED', targetType: 'SUPPORT_QUESTION', targetId: row.id, ...(ip ? { ip } : {}) });
    return this.view(row);
  }

  async close(actorId: string, id: string, ip?: string): Promise<QuestionView> {
    const [row] = await this.db
      .update(schema.supportQuestions)
      .set({ status: 'CLOSED', answeredById: actorId, answeredAt: new Date() })
      .where(and(eq(schema.supportQuestions.id, id), eq(schema.supportQuestions.status, 'NEW')))
      .returning();
    if (!row) throw fail(409, 'QUESTION_CLOSED', 'На этот вопрос уже ответили или он закрыт.');
    await this.audit.log({ actorId, action: 'SUPPORT_CLOSED', targetType: 'SUPPORT_QUESTION', targetId: row.id, ...(ip ? { ip } : {}) });
    return this.view(row);
  }

  private view(r: typeof schema.supportQuestions.$inferSelect): QuestionView {
    return { id: r.id, text: r.text, status: r.status, answer: r.answer, createdAt: r.createdAt, answeredAt: r.answeredAt };
  }
}
