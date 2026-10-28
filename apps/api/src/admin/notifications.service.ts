import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { type EmailSender } from '../auth/email-sender.js';
import { DB, EMAIL_SENDER } from '../tokens.js';
import { fail } from './errors.js';

export interface NoticeInput {
  userId: string;
  kind: string;
  title: string;
  body: string;
  projectId?: string | null;
}

/** A message to a user: it is kept for the cabinet and goes by mail when the user has a confirmed address (docs/06-TRUST-SAFETY.md §5). */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() @Inject(EMAIL_SENDER) private readonly email: EmailSender | null,
  ) {}

  async notify(input: NoticeInput): Promise<string> {
    const [row] = await this.db
      .insert(schema.notifications)
      .values({ userId: input.userId, kind: input.kind, title: input.title, body: input.body, projectId: input.projectId ?? null })
      .returning({ id: schema.notifications.id });
    const [user] = await this.db.select({ email: schema.users.email, verified: schema.users.emailVerifiedAt }).from(schema.users).where(eq(schema.users.id, input.userId));
    if (user?.email && user.verified && this.email?.sendNotice) {
      // Mail is an extra: a failed delivery must not undo the decision that was just made.
      await this.email.sendNotice(user.email, input.title, input.body).catch(() => undefined);
    }
    return row!.id;
  }

  async list(userId: string): Promise<Array<{ id: string; kind: string; title: string; body: string; projectId: string | null; createdAt: Date; read: boolean }>> {
    const rows = await this.db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId)).orderBy(desc(schema.notifications.createdAt)).limit(50);
    return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, projectId: r.projectId, createdAt: r.createdAt, read: r.readAt !== null }));
  }

  async markRead(userId: string, id: string): Promise<void> {
    const rows = await this.db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)))
      .returning({ id: schema.notifications.id });
    if (rows.length === 0) throw fail(404, 'NOT_FOUND', 'Сообщение не найдено');
  }
}
