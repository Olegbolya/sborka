import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { schema } from '@blokum/db';
import { createBlock, type ProjectDocument } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import { storageNotice } from '../src/media/entitlements.js';
import { creatorLimitNotice } from '../src/play/creator-limits.js';
import { SCHEDULE_WINDOW_MS, ScheduleNoticesService, scheduleText } from '../src/play/schedule-notices.service.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

const JPEG_1PX = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
  0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
  0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
  0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
  0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
  0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
  0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d,
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
  0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
  0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xfb, 0xff,
  0xd9,
]);

const MB = 1024 * 1024;

describe('D-07 · уведомления о лимитах и расписании', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;
  const sentCodes: { phone: string; code: string }[] = [];
  let phoneCounter = 0;
  let sha = 0;

  const login = async (): Promise<{ cookie: string; id: string }> => {
    await db.db.delete(schema.otpRequests);
    const phone = `+7902${String(4000000 + ++phoneCounter).slice(-7)}`;
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const { code } = sentCodes.pop()!;
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code }).expect(200);
    const cookie = ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
    const me = (await request(t.http()).get(`/${API_PREFIX}/auth/account`).set('Cookie', cookie).expect(200)).body as { id: string };
    return { cookie, id: me.id };
  };
  const api = (cookie: string, method: 'get' | 'post' | 'put' | 'patch', url: string, body?: unknown) => {
    const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
    return body === undefined ? r : r.send(body as object);
  };
  const open = (url: string, body: unknown = {}) => request(t.http()).post(`/${API_PREFIX}${url}`).set('X-Blokum-CSRF', '1').send(body as object);
  const kinds = async (userId: string, prefix: string): Promise<string[]> =>
    (await db.db.select({ kind: schema.notifications.kind }).from(schema.notifications).where(eq(schema.notifications.userId, userId))).map((r) => r.kind).filter((k) => k.startsWith(prefix)).sort();
  const publish = async (cookie: string, title: string): Promise<{ id: string; slug: string }> => {
    const created = (await api(cookie, 'post', '/projects', { title }).expect(200)).body as { id: string; slug: string; document: ProjectDocument; draftVersionNumber: number };
    created.document.screens[0]!.blocks.push(createBlock('button'));
    await api(cookie, 'put', `/projects/${created.id}/draft`, { document: created.document }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    await api(cookie, 'post', `/projects/${created.id}/publish`).expect(200);
    return { id: created.id, slug: created.slug };
  };
  const subscribe = (userId: string, planCode: string) =>
    db.db.insert(schema.subscriptions).values({ userId, planCode, period: 'MONTH', status: 'ACTIVE', currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 29 * 86_400_000) });

  beforeAll(async () => {
    try {
      db = await createTestDb();
      const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => (sentCodes.push({ phone, code }), Promise.resolve())) };
      const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
      t = await startTestApp({ db: db.db, otpSender, captchaVerifier }, { phoneLogin: true });
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  it('D-07 · storageNotice: 80 % и 95 % места — по одному разу при пересечении, середина и повтор молчат', () => {
    const limit = 200 * MB;
    expect(storageNotice(159 * MB, 161 * MB, limit)).toMatchObject({ kind: 'storage-80', title: 'Занято 80 % места под файлы' });
    expect(storageNotice(161 * MB, 170 * MB, limit)).toBeNull();
    expect(storageNotice(189 * MB, 191 * MB, limit)).toMatchObject({ kind: 'storage-95', title: 'Место под файлы почти закончилось' });
    // A big file that jumps over both: the stronger message only.
    expect(storageNotice(10 * MB, 199 * MB, limit)?.kind).toBe('storage-95');
    expect(storageNotice(10 * MB, 20 * MB, limit)).toBeNull();
    expect(storageNotice(0, 1, 0)).toBeNull();
    expect(storageNotice(159 * MB, 161 * MB, limit)!.body).toContain('Занято 161 МБ из 200 МБ.');
  });

  it('D-07 · загрузка, после которой занято больше 80 % хранилища, присылает сообщение в кабинет один раз', async () => {
    const u = await login();
    // «Старт»: 200 МБ. Already taken: just under 80 %.
    await db.db.insert(schema.media).values({ ownerId: u.id, kind: 'IMAGE', mime: 'image/jpeg', bytes: 160 * MB - 100, sha256: `s${++sha}`, status: 'READY' });
    const upload = () => request(t.http()).post(`/${API_PREFIX}/media`).set('Cookie', u.cookie).set('X-Blokum-CSRF', '1').attach('file', JPEG_1PX, { filename: 'photo.jpg', contentType: 'image/jpeg' }).expect(201);
    await upload();
    expect(await kinds(u.id, 'storage')).toEqual(['storage-80']);
    await upload();
    expect(await kinds(u.id, 'storage')).toEqual(['storage-80']);
  });

  it('D-07 · creatorLimitNotice: сообщение ровно на пороге своего лимита; без лимита и мимо порога — нет', () => {
    expect(creatorLimitNotice('starts', 5, { maxStarts: 5 }, 'Квиз')).toMatchObject({ kind: 'creator-limit', title: 'Сборка «Квиз» закрылась: набран ваш лимит' });
    expect(creatorLimitNotice('starts', 4, { maxStarts: 5 }, 'Квиз')).toBeNull();
    expect(creatorLimitNotice('starts', 6, { maxStarts: 5 }, 'Квиз')).toBeNull();
    expect(creatorLimitNotice('completions', 3, { maxStarts: 3 }, 'Квиз')).toBeNull();
    expect(creatorLimitNotice('completions', 3, { maxCompletions: 3 }, 'Квиз')!.body).toContain('3 завершённых прохождений');
    expect(creatorLimitNotice('starts', 1, {}, 'Квиз')).toBeNull();
  });

  it('D-07 · свой лимит запусков и завершений набран — одно сообщение в кабинете, сборка закрывается', async () => {
    const u = await login();
    await subscribe(u.id, 'PLUS');
    const a = await publish(u.cookie, 'Лимит запусков');
    await api(u.cookie, 'patch', `/projects/${a.id}/access-settings`, { maxStarts: 2 }).expect(200);
    await open(`/play/${a.id}/sessions`).expect(201);
    expect(await kinds(u.id, 'creator-limit')).toEqual([]);
    await open(`/play/${a.id}/sessions`).expect(201);
    expect(await kinds(u.id, 'creator-limit')).toEqual(['creator-limit']);
    await open(`/play/${a.id}/sessions`).expect(403);
    expect(await kinds(u.id, 'creator-limit')).toEqual(['creator-limit']);

    const b = await publish(u.cookie, 'Лимит завершений');
    await api(u.cookie, 'patch', `/projects/${b.id}/access-settings`, { maxCompletions: 1 }).expect(200);
    const sid = ((await open(`/play/${b.id}/sessions`).expect(201)).body as { sessionId: string }).sessionId;
    await open(`/play/sessions/${sid}/complete`).expect(200);
    const notes = await db.db.select().from(schema.notifications).where(and(eq(schema.notifications.projectId, b.id), eq(schema.notifications.kind, 'creator-limit')));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe('Сборка «Лимит завершений» закрылась: набран ваш лимит');
    // A repeated «complete» is not a new completion.
    await open(`/play/sessions/${sid}/complete`).expect(200);
    expect(await db.db.select().from(schema.notifications).where(and(eq(schema.notifications.projectId, b.id), eq(schema.notifications.kind, 'creator-limit')))).toHaveLength(1);
  });

  it('D-07 · расписание: «открылась» и «закрылась» приходят по одному разу; давно прошедшее время и черновик молчат', async () => {
    const u = await login();
    await subscribe(u.id, 'PLUS');
    const p = await publish(u.cookie, 'Ярмарка');
    const service = t.app.get(ScheduleNoticesService);
    const opensAt = new Date(Date.now() + 60_000);
    const closesAt = new Date(Date.now() + 3_600_000);
    await api(u.cookie, 'patch', `/projects/${p.id}/access-settings`, { scheduledOpenAt: opensAt.toISOString(), scheduledCloseAt: closesAt.toISOString() }).expect(200);
    const mine = async () => (await db.db.select().from(schema.notifications).where(eq(schema.notifications.projectId, p.id))).filter((n) => n.kind.startsWith('schedule-'));

    await service.check(new Date(opensAt.getTime() - 1000));
    expect(await mine()).toHaveLength(0);
    await service.check(new Date(opensAt.getTime() + 1000));
    await service.check(new Date(opensAt.getTime() + 2000));
    let notes = await mine();
    expect(notes.map((n) => n.kind)).toEqual(['schedule-open']);
    expect(notes[0]!.title).toBe('Сборка «Ярмарка» открылась по расписанию');
    expect(notes[0]!.body).toContain(`http://localhost:3110/s/${p.slug}`);
    expect(notes[0]!.body).toContain('Закроется');

    await service.check(new Date(closesAt.getTime() + 5000));
    await service.check(new Date(closesAt.getTime() + 6000));
    notes = await mine();
    expect(notes.map((n) => n.kind).sort()).toEqual(['schedule-close', 'schedule-open']);
    expect(notes.find((n) => n.kind === 'schedule-close')!.body).toContain('Завершённых прохождений: 0.');

    // A moment far in the past is not news; an unpublished project is not told about.
    const q = await publish(u.cookie, 'Старое');
    await api(u.cookie, 'patch', `/projects/${q.id}/access-settings`, { scheduledCloseAt: new Date(Date.now() - SCHEDULE_WINDOW_MS - 60_000).toISOString() }).expect(200);
    expect(await service.check(new Date())).toBe(0);
    const draft = (await api(u.cookie, 'post', '/projects', { title: 'Черновик' }).expect(200)).body as { id: string };
    await api(u.cookie, 'patch', `/projects/${draft.id}/access-settings`, { scheduledOpenAt: new Date(Date.now() - 1000).toISOString() }).expect(200);
    expect(await service.check(new Date())).toBe(0);
  });

  it('D-07 · scheduleText: время по Москве, без даты закрытия — без строки «Закроется»', () => {
    const at = new Date('2026-12-01T09:00:00Z');
    const open = scheduleText('open', { title: 'Ёлка', at, closesAt: null, link: 'https://blokker.ru/s/elka', completions: 0 });
    expect(open.body).toBe('С 1 декабря 2026 г. в 12:00 (МСК) участники могут проходить сборку по ссылке https://blokker.ru/s/elka.');
    expect(scheduleText('close', { title: 'Ёлка', at, closesAt: null, link: '', completions: 7 }).body).toContain('Завершённых прохождений: 7.');
  });
});
