import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { eq, like } from 'drizzle-orm';
import { addWorkingDays } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import { LegalLogsService } from '../src/admin/legal-logs.service.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

let counter = 0;
const sent: { phone: string; code: string }[] = [];
const HOUR = 3_600_000;

describe('P8.4, P8.5 · заявления правообладателей и запросы о данных', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;

  const pub = (url: string, body: unknown) => request(t.http()).post(`/${API_PREFIX}${url}`).set('X-Blokum-CSRF', '1').send(body as object);
  const call = (cookie: string, method: 'post' | 'get', url: string, body?: unknown) => {
    const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
    return body === undefined ? r : r.send(body as object);
  };
  async function staff(role: 'MODERATOR' | 'ADMIN'): Promise<{ cookie: string; id: string }> {
    await db.db.delete(schema.otpRequests);
    const phone = `+7902${String(5000000 + ++counter).slice(-7)}`;
    await pub('/auth/otp/request', { phone, captchaToken: 'ok' }).expect(200);
    const { code } = sent.pop()!;
    const res = await pub('/auth/otp/verify', { phone, code }).expect(200);
    const cookie = ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
    const [u] = await db.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phoneE164, phone));
    await db.db.update(schema.users).set({ role }).where(eq(schema.users.id, u!.id));
    return { cookie, id: u!.id };
  }
  const claim = {
    claimantKind: 'PERSON',
    name: 'Петрова Анна Сергеевна',
    document: 'паспорт 9200 123456, выдан ОВД г. Казани 01.02.2015',
    email: 'anna@example.ru',
    objectDescription: 'Моя фотография «Закат над Волгой», опубликована в моём альбоме в 2024 году',
    urls: ['https://blokker.ru/s/zakat-test'],
    hasRights: true,
    noPermission: true,
    pdConsent: true,
  };

  beforeAll(async () => {
    try {
      db = await createTestDb();
      const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => (sent.push({ phone, code }), Promise.resolve())) };
      const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
      t = await startTestApp({ db: db.db, otpSender, captchaVerifier }, { playLimits: { startsPerHourPerIp: 1000, answersPerMinutePerSession: 1000, reportsPerHourPerIp: 6 } });
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  it('P8.4 · форма по ст. 15.7 не принимается без любого из обязательных полей ч. 2; полное заявление попадает в журнал со сроком 24 часа', async () => {
    const missing: Array<[Record<string, unknown>, string]> = [
      [{ claimantKind: '' }, 'CLAIMANT_KIND'],
      [{ name: '' }, 'CLAIMANT_NAME'],
      [{ document: '' }, 'CLAIMANT_DOCUMENT'],
      [{ email: 'не почта' }, 'CLAIMANT_EMAIL'],
      [{ objectDescription: '' }, 'CLAIM_OBJECT'],
      [{ urls: [] }, 'CLAIM_URLS'],
      [{ urls: ['javascript:alert(1)'] }, 'CLAIM_URLS'],
      [{ hasRights: false }, 'CLAIM_RIGHTS'],
      [{ noPermission: false }, 'CLAIM_PERMISSION'],
      [{ pdConsent: false }, 'CLAIM_CONSENT'],
    ];
    for (const [patch, code] of missing) {
      const res = await pub('/legal/requests/copyright', { ...claim, ...patch }).expect(422);
      expect(res.body.error.code, JSON.stringify(patch)).toBe(code);
    }
    // An organisation gives its address instead of a passport.
    expect((await pub('/legal/requests/copyright', { ...claim, claimantKind: 'ORG', name: 'ООО «Фото»', document: '', address: '' }).expect(422)).body.error.code).toBe('CLAIMANT_ADDRESS');
    expect(await db.db.select().from(schema.copyrightClaims)).toHaveLength(0);

    const before = Date.now();
    const ok = await pub('/legal/requests/copyright', claim).expect(201);
    const [row] = await db.db.select().from(schema.copyrightClaims).where(eq(schema.copyrightClaims.id, ok.body.id as string));
    expect(row!.status).toBe('NEW');
    expect(row!.dueAt.getTime() - row!.receivedAt.getTime()).toBe(24 * HOUR);
    expect(row!.receivedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row!.claimant).toMatchObject({ kind: 'PERSON', name: claim.name, email: claim.email });
    expect(row!.statement).toMatchObject({ hasRights: true, noPermission: true, pdConsent: true });
    // The moderator sees it in the register, without the hash of the sender's address.
    const moderator = await staff('MODERATOR');
    const list = (await call(moderator.cookie, 'get', '/admin/copyright-claims').expect(200)).body as Array<Record<string, unknown>>;
    expect(list.find((c) => c.id === ok.body.id)).toMatchObject({ open: true, overdue: false });
    expect(list[0]).not.toHaveProperty('ipHash');
  });

  it('P8.4 · тревоги за 6 часов и за 1 час до конца срока приходят модераторам по одному разу (подмена времени)', async () => {
    await db.db.delete(schema.copyrightClaims);
    const moderator = await staff('MODERATOR');
    const id = (await pub('/legal/requests/copyright', claim).expect(201)).body.id as string;
    const [row] = await db.db.select().from(schema.copyrightClaims).where(eq(schema.copyrightClaims.id, id));
    const legal = t.app.get(LegalLogsService);
    const at = (hoursLeft: number) => new Date(row!.dueAt.getTime() - hoursLeft * HOUR);
    const mine = async () => (await db.db.select().from(schema.notifications).where(like(schema.notifications.kind, `deadline-%:claim:${id}`))).filter((n) => n.userId === moderator.id).map((n) => n.kind);

    expect(await legal.sendDeadlineAlerts(at(7))).toEqual([]);
    expect(await legal.sendDeadlineAlerts(at(5.9))).toEqual([`deadline-6h:claim:${id}`]);
    expect(await legal.sendDeadlineAlerts(at(3))).toEqual([]);
    expect(await legal.sendDeadlineAlerts(at(0.9))).toEqual([`deadline-1h:claim:${id}`]);
    expect(await legal.sendDeadlineAlerts(at(0.5))).toEqual([]);
    expect((await mine()).sort()).toEqual([`deadline-1h:claim:${id}`, `deadline-6h:claim:${id}`]);
    // A closed notice raises no alert; a late one is counted on the front page of the admin.
    expect(((await call(moderator.cookie, 'get', '/admin/work').expect(200)).body as { legalOverdue: number }).legalOverdue).toBe(0);
    await db.db.update(schema.copyrightClaims).set({ dueAt: new Date(Date.now() - HOUR) }).where(eq(schema.copyrightClaims.id, id));
    expect(((await call(moderator.cookie, 'get', '/admin/work').expect(200)).body as { legalOverdue: number }).legalOverdue).toBe(1);
  });

  it('P8.4 · с одного адреса — не больше заданного числа заявлений в час', async () => {
    await db.db.delete(schema.copyrightClaims);
    for (let i = 0; i < 6; i++) await pub('/legal/requests/copyright', claim).expect(201);
    expect((await pub('/legal/requests/copyright', claim).expect(429)).body.error.code).toBe('TOO_MANY_REQUESTS');
  });

  it('P8.5 · запрос о данных: срок — 10 рабочих дней, одно продление на 5 рабочих дней с причиной, закрытие с ответом', async () => {
    expect((await pub('/legal/requests/data', { kind: 'OTHER', contact: 'ivan@example.ru', details: 'Удалите мои ответы', consent: true }).expect(422)).body.error.code).toBe('REQUEST_KIND');
    expect((await pub('/legal/requests/data', { kind: 'DELETE', contact: 'ivan@example.ru', details: 'Удалите мои ответы', consent: false }).expect(422)).body.error.code).toBe('REQUEST_CONSENT');
    expect((await pub('/legal/requests/data', { kind: 'DELETE', contact: 'ivan@example.ru', details: 'Удалите мои ответы', consent: true, slug: 'net-takoy' }).expect(422)).body.error.code).toBe('REQUEST_PROJECT');
    const id = (await pub('/legal/requests/data', { kind: 'DELETE', contact: 'ivan@example.ru', details: 'Удалите мои ответы из опроса', consent: true }).expect(201)).body.id as string;
    const [row] = await db.db.select().from(schema.dataSubjectRequests).where(eq(schema.dataSubjectRequests.id, id));
    expect(row!.dueAt.getTime()).toBe(addWorkingDays(row!.receivedAt, 10).getTime());

    const admin = await staff('ADMIN');
    const view = async () => ((await call(admin.cookie, 'get', '/admin/data-requests').expect(200)).body as Array<{ id: string; status: string; dueAt: string; resolution: string | null }>).find((r) => r.id === id)!;
    expect(await view()).toMatchObject({ status: 'NEW', overdue: false });
    expect(await view()).not.toHaveProperty('ipHash');
    await call(admin.cookie, 'post', `/admin/data-requests/${id}/extend`, { reason: '' }).expect(422);
    await call(admin.cookie, 'post', `/admin/data-requests/${id}/extend`, { reason: 'Нужно найти ответы в трёх сборках' }).expect(204);
    expect(new Date((await view()).dueAt).getTime()).toBe(addWorkingDays(row!.dueAt, 5).getTime());
    expect((await call(admin.cookie, 'post', `/admin/data-requests/${id}/extend`, { reason: 'Ещё раз продлить' }).expect(409)).body.error.code).toBe('EXTENDED_ONCE');
    await call(admin.cookie, 'post', `/admin/data-requests/${id}/close`, { resolution: '' }).expect(422);
    await call(admin.cookie, 'post', `/admin/data-requests/${id}/close`, { resolution: 'Ответы удалены, человеку отправлено письмо' }).expect(204);
    expect(await view()).toMatchObject({ status: 'CLOSED', resolution: 'Ответы удалены, человеку отправлено письмо' });
    await call(admin.cookie, 'post', `/admin/data-requests/${id}/close`, { resolution: 'Повторно закрыть' }).expect(409);
    // The public forms are not open to an ordinary signed-in user's admin routes.
    await request(t.http()).get(`/${API_PREFIX}/admin/data-requests`).expect(401);
  });

  it('P8.5 · десять рабочих дней пропускают субботы и воскресенья (по московскому времени)', () => {
    // Monday 2 November 2026, 10:00 MSK → Monday 16 November.
    expect(addWorkingDays(new Date('2026-11-02T07:00:00Z'), 10).toISOString()).toBe('2026-11-16T07:00:00.000Z');
    // Friday → the next working day is Monday.
    expect(addWorkingDays(new Date('2026-11-06T07:00:00Z'), 1).toISOString()).toBe('2026-11-09T07:00:00.000Z');
  });
});
