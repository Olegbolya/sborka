import { createHash } from 'node:crypto';
import { type BlockInput, DEFAULT_COLORS, ProjectDocument, ThemeTokens, textOf } from '@blokum/schema';
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
const DEV_GIFTS = ['Велосипед', 'Книгу', 'Снегоката', 'Котёнка'];

/**
 * A valid document (checked by the @blokum/schema parser) with fixed ids, so the seed stays idempotent:
 * screen 1 holds the question «question1» with options «option1…4» (the dev answers refer to them),
 * the last screen is the result screen.
 */
export const devDoc = (title: string, screens: number): ProjectDocument => {
  const next = (id: string): BlockInput => ({
    id,
    type: 'button',
    name: 'Кнопка',
    frame: { x: 75, y: 700, w: 240, h: 56 },
    textLayer: textOf('Дальше'),
    props: {},
    rules: [{ id: `${id}rule`, when: { kind: 'tap', source: { kind: 'block', blockId: id } }, do: [{ kind: 'goTo', to: 'next' }] }],
  });
  const question: BlockInput = {
    id: 'question1',
    type: 'singleChoice',
    name: 'Какой подарок вы хотите?',
    frame: { x: 32, y: 160, w: 326, h: 320 },
    props: { required: true, options: DEV_GIFTS.map((_, i) => ({ id: `option${i + 1}`, blockId: `option${i + 1}blk` })) },
    children: DEV_GIFTS.map((gift, i) => ({
      id: `option${i + 1}blk`,
      type: 'shape',
      name: gift,
      frame: { x: 0, y: i * 72, w: 326, h: 56 },
      textLayer: textOf(gift),
      props: {},
    })),
  };
  return ProjectDocument.parse({
    schemaVersion: 1,
    meta: { title },
    screens: Array.from({ length: screens }, (_, i) => {
      const last = i === screens - 1;
      const blocks: BlockInput[] = [];
      if (i === 0) blocks.push(question);
      if (!last) blocks.push(next(`next${i + 1}btn`));
      return { id: `screen${i + 1}`, name: `Экран ${i + 1}`, kind: last ? 'result' : i === 0 ? 'question' : 'content', blocks };
    }),
  });
};

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
      tokens: ThemeTokens.parse({ colors: { ...DEFAULT_COLORS, background: '#7A1F1F', surface: '#8E2A2A', accent: '#F2C14E', text: '#FFF8EE', muted: '#E8D8C4' } }),
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

  const gifts = DEV_GIFTS;
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
