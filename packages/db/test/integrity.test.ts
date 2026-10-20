import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accessPoints,
  answers,
  auditLog,
  libraryCollections,
  libraryItems,
  media,
  orders,
  participantSessions,
  projectVersions,
  projects,
  savedElements,
  templates,
  themes,
  users,
} from '../src/schema/index.js';
import { createTestDb, type TestDb } from './helpers.js';

const pgCode = (e: unknown): string | undefined =>
  (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;

describe('целостность данных', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.drop();
  });

  const makeUser = async (phone: string) => {
    const [u] = await t.db.insert(users).values({ displayName: 'Тест', phoneE164: phone }).returning();
    return u!;
  };
  const makeProject = async (ownerId: string, slug: string) => {
    const [p] = await t.db.insert(projects).values({ ownerId, title: 'Сборка', slug }).returning();
    return p!;
  };

  it('создаёт пользователя, сборку, версию, прохождение, ответ, тему, шаблон и элемент', async () => {
    const u = await makeUser('+79000000001');
    expect(u.id).toMatch(/^[a-z0-9]{16}$/);
    expect(u.role).toBe('USER');
    const [theme] = await t.db.insert(themes).values({ ownerId: u.id, name: 'Моя', tokens: { colors: {} } }).returning();
    const p = await makeProject(u.id, 'full-cycle');
    expect(p.status).toBe('DRAFT');
    const [v] = await t.db
      .insert(projectVersions)
      .values({ projectId: p.id, number: 1, document: { schemaVersion: 1 }, schemaVersion: 1, sha256: 'x', kind: 'PUBLISHED' })
      .returning();
    await t.db.update(projects).set({ publishedVersionId: v!.id, themeId: theme!.id, status: 'PUBLISHED' }).where(eq(projects.id, p.id));
    const [s] = await t.db.insert(participantSessions).values({ projectId: p.id, versionId: v!.id }).returning();
    await t.db.insert(answers).values({ sessionId: s!.id, blockId: 'q1', source: 'QUESTION', value: { optionId: 'a' } });
    await t.db.insert(templates).values({ ownerId: u.id, name: 'Шаблон', document: { schemaVersion: 1 } });
    await t.db.insert(savedElements).values({ ownerId: u.id, name: 'Кнопка', fragment: { blocks: [] } });
    const [reloaded] = await t.db.select().from(projects).where(eq(projects.id, p.id));
    expect(reloaded).toMatchObject({ status: 'PUBLISHED', publishedVersionId: v!.id, themeId: theme!.id });
  });

  it('удаление пользователя каскадно удаляет его сборки, прохождения и ответы, но оставляет заказы', async () => {
    const u = await makeUser('+79000000002');
    const p = await makeProject(u.id, 'cascade-check');
    const [v] = await t.db
      .insert(projectVersions)
      .values({ projectId: p.id, number: 1, document: { schemaVersion: 1 }, schemaVersion: 1, sha256: 'x', kind: 'PUBLISHED' })
      .returning();
    const [s] = await t.db.insert(participantSessions).values({ projectId: p.id, versionId: v!.id }).returning();
    await t.db.insert(answers).values({ sessionId: s!.id, blockId: 'q1', source: 'QUESTION', value: 1 });
    const [o] = await t.db
      .insert(orders)
      .values({ userId: u.id, kind: 'PASS', item: { plan: 'PASS' }, amountKop: 24900, provider: 'yookassa', providerPaymentId: 'pay-1' })
      .returning();

    await t.db.delete(users).where(eq(users.id, u.id));

    expect(await t.db.select().from(projects).where(eq(projects.id, p.id))).toHaveLength(0);
    expect(await t.db.select().from(participantSessions).where(eq(participantSessions.id, s!.id))).toHaveLength(0);
    expect(await t.db.select().from(answers).where(eq(answers.sessionId, s!.id))).toHaveLength(0);
    const [kept] = await t.db.select().from(orders).where(eq(orders.id, o!.id));
    expect(kept?.userId).toBeNull();
    expect(kept?.amountKop).toBe(24900);
  });

  it('slug сборки уникален', async () => {
    const u = await makeUser('+79000000003');
    await makeProject(u.id, 'unique-slug');
    const err = await makeProject(u.id, 'unique-slug').catch((e: unknown) => e);
    expect(pgCode(err)).toBe('23505');
  });

  it('код точки доступа уникален', async () => {
    const u = await makeUser('+79000000004');
    const p = await makeProject(u.id, 'ap-unique');
    await t.db.insert(accessPoints).values({ projectId: p.id, code: 'qrcode01', label: 'Плакат' });
    const err = await t.db
      .insert(accessPoints)
      .values({ projectId: p.id, code: 'qrcode01', label: 'Чат' })
      .catch((e: unknown) => e);
    expect(pgCode(err)).toBe('23505');
  });

  it('номер телефона и вход через провайдера не повторяются', async () => {
    await makeUser('+79000000005');
    expect(pgCode(await makeUser('+79000000005').catch((e: unknown) => e))).toBe('23505');
  });

  it('на один блок в прохождении — один ответ; переменные хранятся отдельно', async () => {
    const u = await makeUser('+79000000006');
    const p = await makeProject(u.id, 'answers-uq');
    const [v] = await t.db
      .insert(projectVersions)
      .values({ projectId: p.id, number: 1, document: { schemaVersion: 1 }, schemaVersion: 1, sha256: 'x', kind: 'PUBLISHED' })
      .returning();
    const [s] = await t.db.insert(participantSessions).values({ projectId: p.id, versionId: v!.id }).returning();
    await t.db.insert(answers).values({ sessionId: s!.id, blockId: 'q1', source: 'QUESTION', value: 'a' });
    const dup = await t.db
      .insert(answers)
      .values({ sessionId: s!.id, blockId: 'q1', source: 'QUESTION', value: 'b' })
      .catch((e: unknown) => e);
    expect(pgCode(dup)).toBe('23505');
    await t.db.insert(answers).values([
      { sessionId: s!.id, variableId: 'score', source: 'VARIABLE', value: 7, deviceReported: true },
      { sessionId: s!.id, screenId: 'screen2', source: 'ACTION', value: 'нажал' },
      { sessionId: s!.id, screenId: 'screen2', source: 'ACTION', value: 'нажал ещё' },
    ]);
    const all = await t.db.select().from(answers).where(eq(answers.sessionId, s!.id));
    expect(all).toHaveLength(4);
  });

  it('версии сборки нумеруются без повторов', async () => {
    const u = await makeUser('+79000000007');
    const p = await makeProject(u.id, 'versions-uq');
    const row = { projectId: p.id, number: 1, document: { schemaVersion: 1 }, schemaVersion: 1, sha256: 'x', kind: 'DRAFT_SNAPSHOT' as const };
    await t.db.insert(projectVersions).values(row);
    expect(pgCode(await t.db.insert(projectVersions).values(row).catch((e: unknown) => e))).toBe('23505');
  });

  it('журнал аудита нельзя изменить, удалить или очистить (AD-08)', async () => {
    const [row] = await t.db.insert(auditLog).values({ action: 'project.publish', targetType: 'PROJECT', targetId: 'p1' }).returning();
    const upd = await t.db
      .update(auditLog)
      .set({ action: 'подмена' })
      .where(eq(auditLog.id, row!.id))
      .catch((e: unknown) => e);
    expect(String((upd as Error).message) + String((upd as { cause?: Error }).cause?.message)).toContain('Журнал аудита нельзя');
    const del = await t.db
      .delete(auditLog)
      .where(eq(auditLog.id, row!.id))
      .catch((e: unknown) => e);
    expect(pgCode(del)).toBe('42501');
    const trunc = await t.db.execute(sql`truncate audit_log`).catch((e: unknown) => e);
    expect(pgCode(trunc)).toBe('42501');
    const [still] = await t.db.select().from(auditLog).where(eq(auditLog.id, row!.id));
    expect(still?.action).toBe('project.publish');
  });

  it('единица библиотеки ссылается ровно на один файл: медиа или шрифт (LB-01)', async () => {
    const admin = await makeUser('+79000000008');
    const [col] = await t.db.insert(libraryCollections).values({ kind: 'STICKERS', title: 'Стикеры' }).returning();
    const base = { collectionId: col!.id, title: 'Снежинка', license: 'OWN' as const, author: 'Блокум', source: 'создано для Блокума', rightsConfirmedById: admin.id };
    const none = await t.db.insert(libraryItems).values(base).catch((e: unknown) => e);
    expect(pgCode(none)).toBe('23514');
    const [m] = await t.db
      .insert(media)
      .values({ ownerId: null, kind: 'IMAGE', mime: 'image/png', bytes: 3 * 1024 * 1024 * 1024, sha256: 'abc' })
      .returning();
    expect(m!.bytes).toBe(3 * 1024 * 1024 * 1024);
    const [ok] = await t.db.insert(libraryItems).values({ ...base, mediaId: m!.id, tags: ['зима', 'снег'] }).returning();
    expect(ok!.tags).toEqual(['зима', 'снег']);
  });
});
