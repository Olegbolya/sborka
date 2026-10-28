import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { DB } from '../tokens.js';
import { fail } from './errors.js';
import { ModerationService } from './moderation.service.js';

const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

/** AD-02 · users: search, profile with projects, payments and the history of decisions. */
@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly moderation: ModerationService,
  ) {}

  async search(qRaw: unknown) {
    const q = typeof qRaw === 'string' ? qRaw.trim() : '';
    if (q.length < 2) throw fail(422, 'QUERY', 'Введите хотя бы два знака: имя, номер, почту или номер в VK ID / Яндекс ID.');
    const byIdentity = this.db.select({ id: schema.authIdentities.userId }).from(schema.authIdentities).where(eq(schema.authIdentities.providerUserId, q));
    const rows = await this.db
      .select({
        id: schema.users.id,
        displayName: schema.users.displayName,
        role: schema.users.role,
        status: schema.users.status,
        email: schema.users.email,
        createdAt: schema.users.createdAt,
        legalHold: schema.users.legalHold,
      })
      .from(schema.users)
      .where(
        and(
          isNull(schema.users.deletedAt),
          or(
            eq(schema.users.id, q),
            ilike(schema.users.displayName, like(q)),
            ilike(schema.users.email, like(q)),
            ilike(schema.users.phoneE164, like(q)),
            sql`${schema.users.id} in (${byIdentity})`,
          ),
        ),
      )
      .orderBy(desc(schema.users.createdAt))
      .limit(50);
    return rows;
  }

  async profile(id: string) {
    const [u] = await this.db
      .select({
        id: schema.users.id,
        displayName: schema.users.displayName,
        role: schema.users.role,
        status: schema.users.status,
        email: schema.users.email,
        emailVerifiedAt: schema.users.emailVerifiedAt,
        phoneE164: schema.users.phoneE164,
        legalHold: schema.users.legalHold,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, id));
    if (!u) throw fail(404, 'NOT_FOUND', 'Пользователь не найден');
    const identities = await this.db.select({ provider: schema.authIdentities.provider, providerUserId: schema.authIdentities.providerUserId }).from(schema.authIdentities).where(eq(schema.authIdentities.userId, id));
    const projects = await this.db
      .select({ id: schema.projects.id, title: schema.projects.title, status: schema.projects.status, moderationStatus: schema.projects.moderationStatus, legalHold: schema.projects.legalHold, updatedAt: schema.projects.updatedAt })
      .from(schema.projects)
      .where(and(eq(schema.projects.ownerId, id), isNull(schema.projects.deletedAt)))
      .orderBy(desc(schema.projects.updatedAt))
      .limit(200);
    const orders = await this.db
      .select({ id: schema.orders.id, kind: schema.orders.kind, amountKop: schema.orders.amountKop, status: schema.orders.status, createdAt: schema.orders.createdAt, paidAt: schema.orders.paidAt })
      .from(schema.orders)
      .where(eq(schema.orders.userId, id))
      .orderBy(desc(schema.orders.createdAt))
      .limit(100);
    const [sessions] = await this.db.select({ n: count() }).from(schema.sessions).where(and(eq(schema.sessions.userId, id), isNull(schema.sessions.revokedAt)));
    const history = await this.moderation.history({ ownerId: id });
    const projectHistory = (await Promise.all(projects.map((p) => this.moderation.history({ projectId: p.id })))).flat();
    const complaints = await this.db
      .select({ n: count() })
      .from(schema.reports)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.reports.projectId))
      .where(eq(schema.projects.ownerId, id));
    return {
      user: u,
      identities: identities.map((i) => ({ provider: i.provider, providerUserId: i.providerUserId })),
      projects,
      orders,
      activeSessions: sessions?.n ?? 0,
      complaints: complaints[0]?.n ?? 0,
      history: [...history, ...projectHistory].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    };
  }
}
