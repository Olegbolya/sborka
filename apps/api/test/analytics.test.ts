import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { and, eq, sql } from 'drizzle-orm';
import { createBlock, createDocument, createScreen } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import { AnalyticsService } from '../src/projects/analytics.service.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

const DAY = 86_400_000;
const sent: { phone: string; code: string }[] = [];
let counter = 0;

describe('P6.5 · D-05 · аналитика: сводки по дням, воронка, ответы', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;
  let cookie: string;
  let ownerId: string;
  const dayOf = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();

  const open = (method: 'post', url: string, body: unknown) => request(t.http())[method](`/${API_PREFIX}${url}`).set('X-Blokum-CSRF', '1').send(body as object);
  const get = (url: string, c = cookie) => request(t.http()).get(`/${API_PREFIX}${url}`).set('Cookie', c);

  async function login(phone: string): Promise<{ cookie: string; id: string }> {
    await db.db.delete(schema.otpRequests);
    await open('post', '/auth/otp/request', { phone, captchaToken: 'ok' }).expect(200);
    const res = await open('post', '/auth/otp/verify', { phone, code: sent.pop()!.code }).expect(200);
    const c = ((res.headers['set-cookie'] ?? []) as string[]).find((x) => x.startsWith('session='))!.split(';')[0]!;
    return { cookie: c, id: (await db.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phoneE164, phone)))[0]!.id };
  }

  beforeAll(async () => {
    try {
      db = await createTestDb();
      const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => (sent.push({ phone, code }), Promise.resolve())) };
      const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
      t = await startTestApp({ db: db.db, otpSender, captchaVerifier });
      ({ cookie, id: ownerId } = await login('+79051230001'));
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  async function project(doc = createDocument({ title: 'Опрос' })) {
    const [p] = await db.db.insert(schema.projects).values({ ownerId, title: 'Опрос', slug: `an-${++counter}-${Date.now()}`, status: 'PUBLISHED' }).returning();
    const [v] = await db.db.insert(schema.projectVersions).values({ projectId: p!.id, number: 1, document: doc as never, schemaVersion: 1, sha256: `v${counter}`, kind: 'PUBLISHED' }).returning();
    const [ap] = await db.db.insert(schema.accessPoints).values({ projectId: p!.id, code: `c${counter}-${Date.now()}`, kind: 'LINK', label: 'Ссылка из чата' }).returning();
    const [qr] = await db.db.insert(schema.accessPoints).values({ projectId: p!.id, code: `q${counter}-${Date.now()}`, kind: 'QR', label: '' }).returning();
    return { id: p!.id, versionId: v!.id, link: ap!.id, qr: qr!.id };
  }
  type P = Awaited<ReturnType<typeof project>>;
  async function passage(p: P, daysAgo: number, o: { ap?: string | null; done?: boolean; ms?: number; device?: 'PHONE' | 'DESKTOP'; preview?: boolean; state?: Record<string, unknown>; resultKey?: string } = {}) {
    const startedAt = new Date(now.getTime() - daysAgo * DAY - 3_600_000);
    const [s] = await db.db
      .insert(schema.participantSessions)
      .values({
        projectId: p.id,
        versionId: p.versionId,
        accessPointId: o.ap ?? null,
        startedAt,
        lastActivityAt: startedAt,
        status: o.done ? 'COMPLETED' : 'IN_PROGRESS',
        completedAt: o.done ? new Date(startedAt.getTime() + (o.ms ?? 60_000)) : null,
        durationMs: o.done ? (o.ms ?? 60_000) : null,
        deviceType: o.device ?? 'PHONE',
        isPreview: o.preview ?? false,
        runtimeState: o.state ?? null,
        resultKey: o.resultKey ?? null,
      })
      .returning();
    return s!.id;
  }

  it('P6.5 · сумма сводок по дням равна выборке из сырых данных: 3 сборки, 30 дней', async () => {
    const svc = t.app.get(AnalyticsService);
    const projects = [await project(), await project(), await project()];
    let seed = 7;
    const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    for (const p of projects) {
      for (let d = 0; d < 30; d++) {
        const n = Math.floor(rnd() * 5);
        for (let i = 0; i < n; i++) {
          const ap = [null, p.link, p.qr][Math.floor(rnd() * 3)] ?? null;
          await passage(p, d + 1 - (d === 0 ? 1 : 0), { ap, done: rnd() < 0.6, ms: 20_000 + Math.floor(rnd() * 100_000), device: rnd() < 0.5 ? 'PHONE' : 'DESKTOP' });
        }
      }
      await passage(p, 3, { preview: true, done: true }); // предпросмотр не считается
    }
    await svc.rollup(dayOf(new Date(now.getTime() - 31 * DAY)), dayOf(now));
    await svc.rollup(dayOf(new Date(now.getTime() - 31 * DAY)), dayOf(now)); // повторный расчёт ничего не меняет
    for (const p of projects) {
      const raw = await db.db.execute(sql`select count(*)::int as starts, count(*) filter (where status = 'COMPLETED')::int as completions, coalesce(round(avg(duration_ms) filter (where status = 'COMPLETED')), 0)::int as avg from participant_sessions where project_id = ${p.id} and is_preview = false`);
      const rawRow = raw.rows[0] as { starts: number; completions: number; avg: number };
      const days = await db.db.select().from(schema.projectStatsDaily).where(and(eq(schema.projectStatsDaily.projectId, p.id), eq(schema.projectStatsDaily.accessPointId, '')));
      expect(days.reduce((s, r) => s + r.starts, 0)).toBe(rawRow.starts);
      expect(days.reduce((s, r) => s + r.completions, 0)).toBe(rawRow.completions);
      expect(rawRow.starts).toBeGreaterThan(20);
      // и по каждой точке входа
      const points = await db.db.select().from(schema.projectStatsDaily).where(and(eq(schema.projectStatsDaily.projectId, p.id), sql`${schema.projectStatsDaily.accessPointId} <> ''`));
      const noPoint = rawRow.starts - points.reduce((s, r) => s + r.starts, 0);
      const rawNoPoint = ((await db.db.execute(sql`select count(*)::int as n from participant_sessions where project_id = ${p.id} and is_preview = false and access_point_id is null`)).rows[0] as { n: number }).n;
      expect(noPoint).toBe(rawNoPoint);
    }
  });

  it('P6.5 · ответ API за 30 дней: итоги, дни, точки входа, устройства; чужая сборка закрыта', async () => {
    const p = await project();
    await passage(p, 2, { ap: p.link, done: true, ms: 30_000, device: 'PHONE' });
    await passage(p, 2, { ap: p.link, done: true, ms: 90_000, device: 'DESKTOP' });
    await passage(p, 5, { ap: p.qr, done: false, device: 'PHONE' });
    await passage(p, 40, { done: true }); // за пределами 30 дней
    await db.db.insert(schema.projectStatsDaily).values({ projectId: p.id, day: dayOf(new Date(now.getTime() - 2 * DAY)), accessPointId: p.link, opens: 5 }).onConflictDoNothing();
    await db.db.insert(schema.projectStatsDaily).values({ projectId: p.id, day: dayOf(new Date(now.getTime() - 2 * DAY)), accessPointId: '', opens: 5 }).onConflictDoNothing();
    const res = await get(`/projects/${p.id}/analytics`).expect(200);
    const a = res.body as { totals: { starts: number; completions: number; completionRate: number; avgDurationMs: number; opens: number }; byAccessPoint: Array<{ label: string; starts: number; completions: number; opens: number }>; byDevice: Array<{ device: string; starts: number }> };
    expect(a.totals).toMatchObject({ starts: 3, completions: 2, completionRate: 66.7, avgDurationMs: 60_000, opens: 5 });
    expect(a.byAccessPoint.find((x) => x.label === 'Ссылка из чата')).toMatchObject({ starts: 2, completions: 2, opens: 5 });
    expect(a.byAccessPoint.find((x) => x.label === 'QR-код')).toMatchObject({ starts: 1, completions: 0 });
    expect(a.byDevice).toEqual(expect.arrayContaining([expect.objectContaining({ device: 'PHONE', starts: 2 }), expect.objectContaining({ device: 'DESKTOP', starts: 1 })]));
    const other = await login('+79051230002');
    await get(`/projects/${p.id}/analytics`, other.cookie).expect(403);
    await request(t.http()).get(`/${API_PREFIX}/projects/${p.id}/analytics`).expect(401);
  });

  it('P6.5 · воронка по экранам, место ухода, распределение ответов и результаты', async () => {
    const doc = createDocument({ title: 'Викторина' });
    const q = createBlock('singleChoice');
    const second = createScreen('Второй');
    const third = createScreen('Третий');
    doc.screens[0]!.blocks.push(q);
    doc.screens.push(second, third);
    const p = await project(doc);
    const first = doc.screens[0]!.id;
    const options = (q.props as { options: Array<{ id: string }> }).options;
    const answer = async (sid: string, optionId: string, ms: number) =>
      db.db.insert(schema.answers).values({ sessionId: sid, screenId: first, blockId: q.id, source: 'QUESTION', value: { kind: 'choice', optionIds: [optionId] }, timeOnScreenMs: ms } as never);
    const a = await passage(p, 1, { done: true, resultKey: 'Эксперт', state: { screenId: third.id, history: [first, second.id] } });
    const b = await passage(p, 1, { state: { screenId: second.id, history: [first] } });
    const c = await passage(p, 1, { state: { screenId: first, history: [] } });
    await answer(a, options[0]!.id, 4000);
    await answer(b, options[0]!.id, 6000);
    await answer(c, options[1]!.id, 2000);
    const body = (await get(`/projects/${p.id}/analytics`).expect(200)).body as {
      funnel: Array<{ name: string; reached: number; leftHere: number; avgTimeMs: number | null }>;
      questions: Array<{ answered: number; options: Array<{ name: string; count: number }> }>;
      results: Array<{ name: string; count: number }>;
    };
    expect(body.funnel.map((f) => [f.name, f.reached, f.leftHere])).toEqual([['Экран 1', 3, 1], ['Второй', 2, 1], ['Третий', 1, 0]]);
    expect(body.funnel[0]!.avgTimeMs).toBe(4000);
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0]!.answered).toBe(3);
    expect(body.questions[0]!.options.map((o) => o.count)).toEqual(expect.arrayContaining([2, 1]));
    expect(body.results).toEqual([{ key: 'Эксперт', name: 'Эксперт', count: 1 }]);
  });
});
