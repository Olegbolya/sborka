import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@blokum/db';
import { eq, inArray } from 'drizzle-orm';
import { RetentionService } from '../src/admin/retention.service.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

const DAY = 86_400_000;
let counter = 0;

describe('P8.8 · сроки хранения и уничтожение (05-LEGAL §5)', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;
  let svc: RetentionService;
  const now = new Date('2030-06-15T12:00:00Z');
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const yearsBefore = (base: Date, n: number) => {
    const d = new Date(base.getTime() - DAY);
    d.setUTCFullYear(d.getUTCFullYear() - n);
    return d;
  };
  const years = (n: number) => yearsBefore(now, n);

  beforeAll(async () => {
    try {
      db = await createTestDb();
      t = await startTestApp({ db: db.db });
      svc = t.app.get(RetentionService);
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  async function user(extra: Partial<typeof schema.users.$inferInsert> = {}) {
    const [u] = await db.db.insert(schema.users).values({ displayName: 'Тест', phoneE164: `+7903${String(6000000 + ++counter).slice(-7)}`, ...extra }).returning();
    return u!;
  }
  async function project(ownerId: string, extra: Partial<typeof schema.projects.$inferInsert> = {}) {
    const [p] = await db.db.insert(schema.projects).values({ ownerId, title: 'Сборка', slug: `ret-${++counter}-${Date.now()}`, ...extra }).returning();
    const [v] = await db.db.insert(schema.projectVersions).values({ projectId: p!.id, number: 1, document: {} as never, schemaVersion: 1, sha256: `v${counter}`, kind: 'DRAFT_SNAPSHOT' }).returning();
    return { id: p!.id, versionId: v!.id };
  }
  async function passage(p: { id: string; versionId: string }, startedAt: Date) {
    const [s] = await db.db.insert(schema.participantSessions).values({ projectId: p.id, versionId: p.versionId, startedAt, lastActivityAt: startedAt }).returning();
    await db.db.insert(schema.answers).values({ sessionId: s!.id, source: 'QUESTION', value: 'да' } as never);
    return s!.id;
  }
  const exists = async (table: typeof schema.participantSessions | typeof schema.projects | typeof schema.users | typeof schema.media, id: string) =>
    (await db.db.select({ id: table.id }).from(table).where(eq(table.id, id))).length === 1;

  it('P8.8 · ответы — по сроку тарифа или по более короткому сроку создателя', async () => {
    const owner = await user();
    const p = await project(owner.id);
    const q = await project(owner.id, { settings: { answersRetentionDays: 7 } });
    const oldP = await passage(p, ago(31)); // тариф «Бесплатный» хранит 30 дней
    const freshP = await passage(p, ago(29));
    const oldQ = await passage(q, ago(8)); // создатель оставил 7 дней
    const freshQ = await passage(q, ago(6));
    const done = await svc.run(now);
    expect(done.find((d) => d.kind === 'ANSWERS')?.count).toBeGreaterThanOrEqual(2);
    expect(await exists(schema.participantSessions, oldP)).toBe(false);
    expect(await exists(schema.participantSessions, oldQ)).toBe(false);
    expect(await exists(schema.participantSessions, freshP)).toBe(true);
    expect(await exists(schema.participantSessions, freshQ)).toBe(true);
    const left = await db.db.select().from(schema.answers).where(inArray(schema.answers.sessionId, [oldP, oldQ]));
    expect(left).toHaveLength(0);
  });

  it('P8.8 · под холдом (сборка или владелец) ответы не удаляются', async () => {
    const heldOwner = await user({ legalHold: true });
    const a = await project(heldOwner.id);
    const owner = await user();
    const b = await project(owner.id, { legalHold: true });
    const sa = await passage(a, ago(400));
    const sb = await passage(b, ago(400));
    await svc.run(now);
    expect(await exists(schema.participantSessions, sa)).toBe(true);
    expect(await exists(schema.participantSessions, sb)).toBe(true);
  });

  it('P8.8 · удалённая сборка живёт 30 дней, потом исчезает; под холдом остаётся', async () => {
    const owner = await user();
    const recent = await project(owner.id, { deletedAt: ago(29) });
    const old = await project(owner.id, { deletedAt: ago(31) });
    const held = await project(owner.id, { deletedAt: ago(90), legalHold: true });
    const done = await svc.run(now);
    expect(done.find((d) => d.kind === 'PROJECTS')?.count).toBeGreaterThanOrEqual(1);
    expect(await exists(schema.projects, recent.id)).toBe(true);
    expect(await exists(schema.projects, old.id)).toBe(false);
    expect(await exists(schema.projects, held.id)).toBe(true);
  });

  it('P8.8 · удалённый файл: через 30 дней уходит и строка, и файл с диска; под холдом — нет', async () => {
    const owner = await user();
    const mk = async (deletedAt: Date, legalHold = false) => {
      const [m] = await db.db.insert(schema.media).values({ ownerId: owner.id, kind: 'IMAGE', mime: 'image/webp', bytes: 10, sha256: `m${++counter}`, status: 'READY', deletedAt, legalHold }).returning();
      const file = path.join(os.tmpdir(), owner.id, m!.id);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, 'x');
      return { id: m!.id, file };
    };
    const recent = await mk(ago(10));
    const old = await mk(ago(40));
    const held = await mk(ago(40), true);
    await svc.run(now);
    expect(await exists(schema.media, recent.id)).toBe(true);
    expect(await exists(schema.media, old.id)).toBe(false);
    await expect(readFile(old.file)).rejects.toThrow();
    expect(await exists(schema.media, held.id)).toBe(true);
    expect((await readFile(held.file)).toString()).toBe('x');
  });

  it('P8.8 · удалённый аккаунт: 30 дней, потом аккаунт и его данные уходят; согласие закрывается и хранится ещё 3 года', async () => {
    const gone = await user({ deletedAt: ago(31) });
    const recent = await user({ deletedAt: ago(5) });
    const held = await user({ deletedAt: ago(60), legalHold: true });
    const heldByProject = await user({ deletedAt: ago(60) });
    await project(heldByProject.id, { legalHold: true });
    const [c] = await db.db.insert(schema.consentRecords).values({ subjectType: 'USER', subjectId: gone.id, kind: 'TERMS', evidence: { checkboxText: 'Согласен' } }).returning();
    await svc.run(now);
    expect(await exists(schema.users, gone.id)).toBe(false);
    expect(await exists(schema.users, recent.id)).toBe(true);
    expect(await exists(schema.users, held.id)).toBe(true);
    expect(await exists(schema.users, heldByProject.id)).toBe(true);
    const [after] = await db.db.select().from(schema.consentRecords).where(eq(schema.consentRecords.id, c!.id));
    expect(after?.withdrawnAt?.getTime()).toBe(now.getTime()); // кончилось согласие — начался отсчёт трёх лет
    // через три года и день после этого запись о согласии уходит
    await svc.run(new Date(now.getTime() + 3 * 366 * DAY));
    expect((await db.db.select().from(schema.consentRecords).where(eq(schema.consentRecords.id, c!.id)))).toHaveLength(0);
  });

  it('P8.8 · журнал согласий: действующее согласие не трогаем, снятое — 3 года', async () => {
    const owner = await user();
    const ev = { checkboxText: 'Согласен' };
    const ins = async (withdrawnAt: Date | null) => (await db.db.insert(schema.consentRecords).values({ subjectType: 'USER', subjectId: owner.id, kind: 'TERMS', evidence: ev, acceptedAt: years(6), withdrawnAt }).returning())[0]!.id;
    const active = await ins(null);
    const young = await ins(years(2));
    const old = await ins(years(3));
    await svc.run(now);
    const left = (await db.db.select({ id: schema.consentRecords.id }).from(schema.consentRecords).where(inArray(schema.consentRecords.id, [active, young, old]))).map((r) => r.id);
    expect(left.sort()).toEqual([active, young].sort());
  });

  it('P8.8 · заказы — 5 лет, журнал аудита — 3 года, журнал входов — 1 год', async () => {
    const owner = await user();
    const real = new Date(); // база сама не отдаёт строки журнала аудита моложе трёх лет по своим часам
    const years = (n: number) => yearsBefore(real, n);
    const order = async (createdAt: Date) =>
      (await db.db.insert(schema.orders).values({ userId: owner.id, kind: 'PASS', item: {}, amountKop: 100, status: 'PAID', provider: 'test', providerPaymentId: `o${++counter}`, createdAt, paidAt: createdAt }).returning())[0]!.id;
    const oldOrder = await order(years(5));
    const youngOrder = await order(years(4));
    const audit = async (createdAt: Date) => (await db.db.insert(schema.auditLog).values({ action: 'test', targetType: 'x', targetId: `a${++counter}`, createdAt }).returning())[0]!.id;
    const oldAudit = await audit(years(3));
    const youngAudit = await audit(years(2));
    const login = async (createdAt: Date) =>
      (await db.db.insert(schema.sessions).values({ userId: owner.id, tokenHash: `t${++counter}`, createdAt, expiresAt: createdAt, ipHash: 'h' }).returning())[0]!.id;
    const oldLogin = await login(years(1));
    const youngLogin = await login(new Date(real.getTime() - 200 * DAY));
    const done = await svc.run(real);
    for (const kind of ['ORDERS', 'AUDIT', 'LOGINS']) expect(done.find((d) => d.kind === kind)?.count).toBeGreaterThanOrEqual(1);
    const rows = async (table: typeof schema.orders | typeof schema.sessions, ids: string[]) => (await db.db.select({ id: table.id }).from(table).where(inArray(table.id, ids))).map((r) => r.id);
    expect(await rows(schema.orders, [oldOrder, youngOrder])).toEqual([youngOrder]);
    expect(await rows(schema.sessions, [oldLogin, youngLogin])).toEqual([youngLogin]);
    const audits = await db.db.select({ id: schema.auditLog.id }).from(schema.auditLog).where(inArray(schema.auditLog.id, [oldAudit, youngAudit]));
    expect(audits.map((a) => a.id)).toEqual([youngAudit]);
  });

  it('P8.8 · каждое уничтожение записано в журнал уничтожения, без содержимого', async () => {
    const owner = await user({ deletedAt: ago(45) });
    await project(owner.id, { deletedAt: ago(45) });
    const before = (await svc.journal(500)).length;
    const done = await svc.run(now);
    expect(done.length).toBeGreaterThan(0);
    const log = await svc.journal(500);
    expect(log.length).toBe(before + done.length);
    const entry = log.find((l) => l.kind === 'PROJECTS');
    expect(entry?.count).toBeGreaterThanOrEqual(1);
    expect(entry?.basis).toContain('30 дней');
    expect(JSON.stringify(entry)).not.toContain(owner.id);
    // пустой прогон ничего не записывает
    const again = await svc.run(now);
    expect(again).toEqual([]);
    expect((await svc.journal(500)).length).toBe(log.length);
  });

  it('P8.8 · журнал аудита нельзя стирать и править, кроме записей старше 3 лет', async () => {
    const [row] = await db.db.insert(schema.auditLog).values({ action: 'test', targetType: 'x', targetId: 'fresh' }).returning();
    await expect(db.db.delete(schema.auditLog).where(eq(schema.auditLog.id, row!.id))).rejects.toThrow();
    await expect(db.db.update(schema.auditLog).set({ action: 'other' }).where(eq(schema.auditLog.id, row!.id))).rejects.toThrow();
  });
});
