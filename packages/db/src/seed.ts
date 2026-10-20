import { createHash } from 'node:crypto';
import { type Db } from './client.js';
import { PLANS } from './plans.js';
import {
  accessPoints,
  answers,
  participantSessions,
  plans,
  projectVersions,
  projects,
  templates,
  themes,
  users,
} from './schema/index.js';

/**
 * Creates missing plans. Never overwrites existing rows: prices edited in the admin (ADR-008) stay intact.
 * Safe to run on every deploy, including production.
 */
export async function seedPlans(db: Db): Promise<number> {
  const inserted = await db
    .insert(plans)
    .values(PLANS.map((p) => ({ ...p, public: true })))
    .onConflictDoNothing({ target: plans.code })
    .returning({ code: plans.code });
  return inserted.length;
}

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const devDoc = (title: string, screens: number) => ({
  schemaVersion: 1,
  meta: { title },
  screens: Array.from({ length: screens }, (_, i) => ({ id: `screen${i + 1}`, name: `Экран ${i + 1}` })),
});

export const DEV_SEED = {
  creatorId: 'devcreator0001',
  adminId: 'devadmin000001',
  projectIds: ['devproject0001', 'devproject0002', 'devproject0003'],
  themeId: 'devtheme000001',
  templateId: 'devtemplate001',
  sessions: 30,
} as const;

/**
 * Development data: 2 users, 3 projects (one published with 30 passes), 1 own theme, 1 own template.
 * System themes, templates and the library stay EMPTY on purpose (the product must work without them).
 * Idempotent: fixed ids + ON CONFLICT DO NOTHING. Refuses to run in production.
 */
export async function seedDevData(db: Db, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('Тестовые данные нельзя загружать в рабочую базу (NODE_ENV=production)');
  }
  const { creatorId, adminId, projectIds, themeId, templateId } = DEV_SEED;

  await db
    .insert(users)
    .values([
      { id: creatorId, phoneE164: '+79990000001', displayName: 'Тестовый создатель', ageConfirmedAt: new Date() },
      { id: adminId, phoneE164: '+79990000002', displayName: 'Тестовый администратор', role: 'ADMIN', ageConfirmedAt: new Date() },
    ])
    .onConflictDoNothing();

  await db
    .insert(themes)
    .values({
      id: themeId,
      ownerId: creatorId,
      name: 'Моя новогодняя',
      tokens: { colors: { background: '#7a1f1f', accent: '#f2c14e', text: '#fff8ee' }, fonts: {}, blockDefaults: {} },
    })
    .onConflictDoNothing();

  const titles = ['Письмо Деду Морозу', 'Викторина для друзей', 'Опрос о корпоративе'];
  for (const [i, projectId] of projectIds.entries()) {
    const doc = devDoc(titles[i] ?? `Сборка ${i + 1}`, 3);
    const published = i === 0;
    await db
      .insert(projects)
      .values({
        id: projectId,
        ownerId: creatorId,
        title: titles[i] ?? `Сборка ${i + 1}`,
        slug: `dev-sborka-${i + 1}`,
        status: published ? 'PUBLISHED' : 'DRAFT',
        themeId: i === 0 ? themeId : null,
        publishedAt: published ? new Date() : null,
      })
      .onConflictDoNothing();
    await db
      .insert(projectVersions)
      .values({
        id: `${projectId}v1`,
        projectId,
        number: 1,
        document: doc,
        schemaVersion: 1,
        sha256: sha(doc),
        kind: published ? 'PUBLISHED' : 'DRAFT_SNAPSHOT',
        createdById: creatorId,
      })
      .onConflictDoNothing();
    await db
      .insert(accessPoints)
      .values({ id: `${projectId}ap`, projectId, code: `devq${i + 1}`, label: 'Ссылка по умолчанию' })
      .onConflictDoNothing();
  }

  const firstProject = projectIds[0];
  const sessionRows = Array.from({ length: DEV_SEED.sessions }, (_, i) => {
    const started = new Date(Date.UTC(2026, 9, 1 + (i % 20), 10, i));
    const done = i % 5 !== 0;
    return {
      id: `devsession${String(i + 1).padStart(4, '0')}`,
      projectId: firstProject,
      versionId: `${firstProject}v1`,
      accessPointId: `${firstProject}ap`,
      status: done ? ('COMPLETED' as const) : ('ABANDONED' as const),
      startedAt: started,
      completedAt: done ? new Date(started.getTime() + 90_000) : null,
      lastActivityAt: new Date(started.getTime() + 90_000),
      deviceType: i % 3 === 0 ? ('DESKTOP' as const) : ('PHONE' as const),
      durationMs: done ? 90_000 : null,
    };
  });
  await db.insert(participantSessions).values(sessionRows).onConflictDoNothing();

  const gifts = ['Велосипед', 'Книгу', 'Снегоката', 'Котёнка'];
  await db
    .insert(answers)
    .values(
      sessionRows.map((s, i) => ({
        id: `${s.id}a1`,
        sessionId: s.id,
        screenId: 'screen1',
        blockId: 'question1',
        source: 'QUESTION' as const,
        value: { optionId: `option${(i % 4) + 1}`, text: gifts[i % 4] },
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(templates)
    .values({ id: templateId, ownerId: creatorId, name: 'Мой шаблон письма', document: devDoc('Мой шаблон письма', 3) })
    .onConflictDoNothing();
}
