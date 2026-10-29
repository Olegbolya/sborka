import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

import { createBlock, createDocument, createScreen, textOf } from '@blokum/schema';

describe('P10.2 · TPL-03/TPL-04 · сборка из системного шаблона и пустая галерея', () => {
  let t: TestApp;
  let db: TestDb;
  let cookie: string;

  beforeAll(async () => {
    let loginViaOtp: (phone?: string) => Promise<string>;
    ({ t, db, loginViaOtp } = await makeAppWithAuth());
    cookie = await loginViaOtp();
  });
  afterAll(async () => {
    await t.app.close();
    await db.drop();
  });

  const get = (path: string) => request(t.http()).get(`/${API_PREFIX}${path}`).set('Cookie', cookie);
  const post = (path: string, body: object) => request(t.http()).post(`/${API_PREFIX}${path}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send(body);

  it('P10.2 · при пустой галерее список шаблонов пуст, а сборка «с нуля» создаётся как обычно', async () => {
    const list = await get('/templates').expect(200);
    expect((list.body as { templates: unknown[] }).templates).toEqual([]);
    const made = await post('/projects', { title: 'С нуля' }).expect(200);
    const body = made.body as { title: string; document: { screens: unknown[] } };
    expect(body.title).toBe('С нуля');
    expect(body.document.screens).toHaveLength(1);
  });

  it('P10.2 · TPL-03: галерея показывает системные шаблоны, но не снятые и не чужие', async () => {
    const doc = createDocument({ title: 'Поздравление' });
    doc.screens[0]!.blocks.push(createBlock('text', { textLayer: textOf('Поздравляю!') }));
    const [on] = await db.db.insert(schema.templates).values({ name: 'Поздравление', category: 'Праздники', document: doc as never, isSystem: true, sort: 1, publishedAt: new Date() }).returning();
    await db.db.insert(schema.templates).values({ name: 'Снятый', document: doc as never, isSystem: true, deletedAt: new Date() });
    await db.db.insert(schema.templates).values({ name: 'Личный', document: doc as never, isSystem: false });
    const list = await get('/templates').expect(200);
    expect((list.body as { templates: Array<{ id: string; name: string }> }).templates.map((x) => x.name)).toEqual(['Поздравление']);
    expect((list.body as { templates: Array<{ id: string }> }).templates[0]!.id).toBe(on!.id);
  });

  it('P10.2 · TPL-04: сборка из шаблона — полная независимая копия; правка шаблона потом не меняет созданную сборку', async () => {
    const [tpl] = await db.db.select().from(schema.templates).where(eq(schema.templates.name, 'Поздравление'));
    const made = await post('/projects', { templateId: tpl!.id }).expect(200);
    const project = made.body as { id: string; title: string; document: { screens: Array<{ blocks: Array<{ textLayer?: { paragraphs: Array<{ runs: Array<{ t: string }> }> } }> }> } };
    expect(project.title).toBe('Поздравление');
    expect(project.document.screens[0]!.blocks[0]!.textLayer!.paragraphs[0]!.runs[0]!.t).toBe('Поздравляю!');
    const changed = createDocument({ title: 'Поздравление' });
    changed.screens[0]!.blocks.push(createBlock('text', { textLayer: textOf('Другой текст') }));
    changed.screens.push(createScreen('Ещё'));
    await db.db.update(schema.templates).set({ document: changed }).where(eq(schema.templates.id, tpl!.id));
    const again = await get(`/projects/${project.id}`).expect(200);
    const stored = (again.body as { document: { screens: Array<{ blocks: Array<{ textLayer?: { paragraphs: Array<{ runs: Array<{ t: string }> }> } }> }> } }).document;
    expect(stored.screens).toHaveLength(1);
    expect(stored.screens[0]!.blocks[0]!.textLayer!.paragraphs[0]!.runs[0]!.t).toBe('Поздравляю!');
  });

  it('P10.2 · неизвестный, снятый и личный шаблон — «не найден», сборка не создаётся', async () => {
    const before = ((await get('/projects').expect(200)).body as unknown[]).length;
    const rows = await db.db.select().from(schema.templates);
    for (const r of [{ id: 'net-takogo' }, ...rows.filter((x) => x.name !== 'Поздравление')]) await post('/projects', { templateId: r.id }).expect(404);
    expect(((await get('/projects').expect(200)).body as unknown[]).length).toBe(before);
  });
});
