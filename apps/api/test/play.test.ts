import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

let phoneCounter = 0;

/** Создать приложение с перехватом OTP-кодов и вернуть helper для входа. */
async function makeAppWithAuth(): Promise<{ t: TestApp; db: TestDb; loginViaOtp: (phone?: string) => Promise<string> }> {
  const db = await createTestDb();
  const sentCodes: { phone: string; code: string }[] = [];
  const otpSender: OtpSender = {
    sendCode: vi.fn((phone: string, code: string) => {
      sentCodes.push({ phone, code });
      return Promise.resolve();
    }),
  };
  const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
  const t = await startTestApp({ db: db.db, otpSender, captchaVerifier });

  async function loginViaOtp(phone?: string): Promise<string> {
    // Clear rate-limit state between logins
    await db.db.delete(schema.otpRequests);
    const p = phone ?? `+7900${String(1000000 + ++phoneCounter).slice(-7)}`;
    await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/request`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone: p, captchaToken: 'ok' })
      .expect(200);
    const { code } = sentCodes.pop()!;
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/verify`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone: p, code })
      .expect(200);
    const cookies = (res.headers['set-cookie'] ?? []) as string[];
    const sessionCookie = cookies.find((c) => c.startsWith('session='));
    if (!sessionCookie) throw new Error('Нет session cookie');
    return sessionCookie.split(';')[0]!;
  }

  return { t, db, loginViaOtp };
}

import sharp from 'sharp';
import { createBlock, createScreen, type ProjectDocument } from '@blokum/schema';

const call = (t: TestApp, cookie: string, method: 'post' | 'put' | 'patch' | 'get', url: string, body?: unknown) => {
  const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
  return body === undefined ? r : r.send(body as object);
};
const pub = (t: TestApp, url: string) => request(t.http()).get(`/${API_PREFIX}${url}`);

describe('PL-01…PL-05 · публикация и открытие плеера', () => {
  let t: TestApp;
  let db: TestDb;
  let loginViaOtp: (phone?: string) => Promise<string>;
  let cookie: string;

  beforeAll(async () => {
    ({ t, db, loginViaOtp } = await makeAppWithAuth());
  });
  afterAll(async () => {
    await t.app.close();
    await db.drop();
  });
  beforeEach(async () => {
    cookie = await loginViaOtp();
  });

  /** A project with a question that has a key (correct, score, tags) and a second screen. */
  async function project(mutate: (doc: ProjectDocument) => void = () => undefined): Promise<{ id: string; slug: string; doc: ProjectDocument; revision: number }> {
    const created = (await call(t, cookie, 'post', '/projects', { title: 'Викторина' }).expect(200)).body as { id: string; slug: string; document: ProjectDocument; draftVersionNumber: number };
    const doc = created.document;
    const q = createBlock('singleChoice');
    if (q.type === 'singleChoice') {
      q.props.options[0]!.correct = true;
      q.props.options[0]!.score = 5;
      q.props.options[0]!.resultTags = ['лиса'];
    }
    doc.screens[0]!.blocks.push(q, createBlock('button'));
    doc.screens.push(createScreen('Итог'));
    mutate(doc);
    const saved = await call(t, cookie, 'put', `/projects/${created.id}/draft`, { document: doc }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    return { id: created.id, slug: created.slug, doc, revision: (saved.body as { revision: number }).revision };
  }

  it('PL-01 · черновик недоступен участнику: «Недоступно», причина не раскрывается', async () => {
    const p = await project();
    const res = await pub(t, `/play/${p.slug}`).expect(404);
    expect(res.body.error).toMatchObject({ code: 'UNAVAILABLE', message: 'Недоступно' });
    await pub(t, '/play/netakogo').expect(404);
  });

  it('L-08 · публикация с ошибками проверки блокируется списком по-русски, версия не создаётся', async () => {
    const p = await project((d) => {
      d.screens[0]!.blocks.push(createBlock('shape', { rules: [{ id: 'pravilo_x1', when: { kind: 'tap', source: { kind: 'block', blockId: 'netakogo_bloka' } }, do: [{ kind: 'goTo', to: 'next' }] }] }));
    });
    const res = await call(t, cookie, 'post', `/projects/${p.id}/publish`).expect(422);
    expect(res.body.error.code).toBe('PUBLISH_BLOCKED');
    expect(res.body.error.issues[0].message).toMatch(/удалённый блок/);
    await pub(t, `/play/${p.slug}`).expect(404);
    const versions = await db.db.select().from(schema.projectVersions).where(eq(schema.projectVersions.projectId, p.id));
    expect(versions.filter((v) => v.kind === 'PUBLISHED')).toHaveLength(0);
  });

  it('PL-15 · опубликованное видно участнику без ключа ответов, баллов и меток результатов', async () => {
    const p = await project();
    await call(t, cookie, 'post', `/projects/${p.id}/publish`).expect(200);
    const res = await pub(t, `/play/${p.slug}`).expect(200);
    expect(res.body).toMatchObject({ state: 'ok', slug: p.slug, title: 'Викторина', indexable: false });
    const text = JSON.stringify(res.body);
    for (const secret of ['"correct"', '"score"', '"resultTags"', '"weight"']) expect(text).not.toContain(secret);
    expect(res.body.document.results).toEqual([]);
    expect(res.body.document.screens).toHaveLength(2);
  });

  it('PL-05 · публикация — копия: правка черновика и темы доходит до участников только при новой публикации', async () => {
    const p = await project();
    await call(t, cookie, 'post', `/projects/${p.id}/publish`).expect(200);
    const doc = { ...p.doc, meta: { ...p.doc.meta, title: 'Другое название' } };
    await call(t, cookie, 'put', `/projects/${p.id}/draft`, { document: doc }).set('If-Match', String(p.revision)).expect(200);
    expect((await pub(t, `/play/${p.slug}`).expect(200)).body.document.meta.title).toBe('Викторина');
    await call(t, cookie, 'post', `/projects/${p.id}/publish`).expect(200);
    expect((await pub(t, `/play/${p.slug}`).expect(200)).body.document.meta.title).toBe('Другое название');
    const versions = await db.db.select().from(schema.projectVersions).where(eq(schema.projectVersions.projectId, p.id));
    expect(versions.filter((v) => v.kind === 'PUBLISHED')).toHaveLength(2);
  });

  it('§10.3 · закрытая сборка недоступна; расписание: до начала «Откроется …», после конца — «Сборка закрыта» в теме', async () => {
    const p = await project();
    await call(t, cookie, 'post', `/projects/${p.id}/publish`).expect(200);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await call(t, cookie, 'patch', `/projects/${p.id}/access-settings`, { scheduledOpenAt: future }).expect(200);
    const early = (await pub(t, `/play/${p.slug}`).expect(200)).body;
    expect(early).toMatchObject({ state: 'not_open', opensAt: future });
    expect(early.text).toMatch(/^Откроется /);
    expect(early.theme.colors.primary).toMatch(/^#/);
    expect(JSON.stringify(early)).not.toContain('"screens"');
    await call(t, cookie, 'patch', `/projects/${p.id}/access-settings`, { scheduledOpenAt: null, scheduledCloseAt: new Date(Date.now() - 1000).toISOString(), closedText: 'Приём ответов окончен' }).expect(200);
    expect((await pub(t, `/play/${p.slug}`).expect(200)).body).toMatchObject({ state: 'closed', text: 'Приём ответов окончен' });
    await call(t, cookie, 'patch', `/projects/${p.id}/access-settings`, { scheduledCloseAt: null }).expect(200);
    await call(t, cookie, 'post', `/projects/${p.id}/status`, { status: 'CLOSED' }).expect(200);
    await pub(t, `/play/${p.slug}`).expect(404);
  });

  it('PL-04 · картинка из опубликованной сборки раздаётся участникам, чужая и не упомянутая — нет', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#336699' } }).png().toBuffer();
    const up = await request(t.http()).post(`/${API_PREFIX}/media`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(201);
    const other = await request(t.http()).post(`/${API_PREFIX}/media`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').attach('file', await sharp({ create: { width: 5, height: 5, channels: 3, background: '#993366' } }).png().toBuffer(), { filename: 'b.png', contentType: 'image/png' }).expect(201);
    const p = await project((d) => {
      d.meta.ogImage = { source: 'media', id: up.body.id as string };
    });
    await pub(t, `/play/${p.slug}/media/${up.body.id as string}`).expect(404);
    await call(t, cookie, 'post', `/projects/${p.id}/publish`).expect(200);
    const file = await pub(t, `/play/${p.slug}/media/${up.body.id as string}`).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    await pub(t, `/play/${p.slug}/media/${other.body.id as string}`).expect(404);
    const view = (await pub(t, `/play/${p.slug}`).expect(200)).body;
    expect(view.ogImageId).toBe(up.body.id);
    expect(view.media[up.body.id as string]).toMatchObject({ kind: 'IMAGE', mime: 'image/png' });
    expect(view.media[other.body.id as string]).toBeUndefined();
  });

  it('PL-02 · код QR ведёт на текущий адрес сборки, считает переход и переживает смену slug', async () => {
    const p = await project();
    await call(t, cookie, 'post', `/projects/${p.id}/publish`).expect(200);
    const points = (await call(t, cookie, 'get', `/projects/${p.id}/access-points`).expect(200)).body as Array<{ id: string; code: string }>;
    const code = points[0]!.code;
    const first = await pub(t, `/play/scan/${code}`).expect(200);
    expect(first.body).toEqual({ slug: p.slug, source: code });
    await db.db.update(schema.projects).set({ slug: 'novyjadres' }).where(eq(schema.projects.id, p.id));
    expect((await pub(t, `/play/scan/${code}`).expect(200)).body.slug).toBe('novyjadres');
    const stats = await db.db.select().from(schema.projectStatsDaily).where(eq(schema.projectStatsDaily.projectId, p.id));
    expect(stats.find((s) => s.accessPointId === points[0]!.id)?.opens).toBe(2);
    expect(stats.find((s) => s.accessPointId === '')?.opens).toBe(2);
    await call(t, cookie, 'post', `/projects/${p.id}/access-points/${points[0]!.id}/active`, { active: false }).expect(204);
    await pub(t, `/play/scan/${code}`).expect(404);
    await pub(t, '/play/scan/netakogo').expect(404);
  });
});
