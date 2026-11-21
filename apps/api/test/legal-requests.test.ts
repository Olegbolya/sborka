import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { and, eq, like } from 'drizzle-orm';
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

  it('P8.4 · представитель правообладателя прикладывает доверенность: PDF/JPG/PNG до 2 МБ, тип — по содержимому; файл видит только модератор', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
    const rep = { ...claim, representative: 'Адвокат Петров, доверенность № 5 от 01.10.2026' };
    // Без файла представитель не принимается.
    expect((await pub('/legal/requests/copyright', rep).expect(422)).body.error.code).toBe('CLAIM_POA');
    // Файл с чужим содержимым под видом PDF — отказ: тип определяется по первым байтам, а не по имени.
    const fake = { data: Buffer.from('<script>alert(1)</script>').toString('base64'), name: 'x.pdf' };
    expect((await pub('/legal/requests/copyright', { ...rep, powerOfAttorney: fake }).expect(422)).body.error.code).toBe('CLAIM_POA');
    // Больше 2 МБ — отказ.
    const big = { data: Buffer.concat([pdf, Buffer.alloc(2 * 1024 * 1024)]).toString('base64') };
    expect((await pub('/legal/requests/copyright', { ...rep, powerOfAttorney: big }).expect(422)).body.error.code).toBe('CLAIM_POA');
    const ok = await pub('/legal/requests/copyright', { ...rep, powerOfAttorney: { data: pdf.toString('base64') } }).expect(201);
    const [row] = await db.db.select().from(schema.copyrightClaims).where(eq(schema.copyrightClaims.id, ok.body.id as string));
    expect(row!.attachments).toEqual(['poa.pdf']);
    const moderator = await staff('MODERATOR');
    const file = await call(moderator.cookie, 'get', `/admin/copyright-claims/${ok.body.id as string}/files/poa.pdf`).buffer(true).expect(200);
    expect(file.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(file.body as Buffer).equals(pdf)).toBe(true);
    // Чужое имя файла и просмотр без входа не работают.
    await call(moderator.cookie, 'get', `/admin/copyright-claims/${ok.body.id as string}/files/passwd`).expect(404);
    await request(t.http()).get(`/${API_PREFIX}/admin/copyright-claims/${ok.body.id as string}/files/poa.pdf`).expect(401);
    // Заявление без представителя файла не требует.
    await pub('/legal/requests/copyright', claim).expect(201);
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

  it('P8.5 · по контакту из запроса находится человек; выгрузка и удаление — только по найденному, под холдом удалять нельзя, всё в журнале аудита', async () => {
    const [user] = await db.db.insert(schema.users).values({ displayName: 'Иван', email: 'Ivan.Test@Example.ru', phoneE164: '79991234567' }).returning({ id: schema.users.id });
    const [held] = await db.db.insert(schema.users).values({ displayName: 'Под холдом', phoneE164: '79990000001', legalHold: true }).returning({ id: schema.users.id });
    const admin = await staff('ADMIN');
    const make = async (contact: string): Promise<string> => (await pub('/legal/requests/data', { kind: 'ACCESS', contact, details: 'Какие данные у вас обо мне', consent: true }).expect(201)).body.id as string;
    const byMail = await make('ivan.test@example.ru');
    const matches = (await call(admin.cookie, 'get', `/admin/data-requests/${byMail}/matches`).expect(200)).body as Array<{ id: string }>;
    expect(matches.map((m) => m.id)).toEqual([user!.id]);
    const byPhone = await make('8 (999) 123-45-67');
    expect(((await call(admin.cookie, 'get', `/admin/data-requests/${byPhone}/matches`).expect(200)).body as Array<{ id: string }>).map((m) => m.id)).toEqual([user!.id]);
    expect((await call(admin.cookie, 'get', `/admin/data-requests/${await make('nikto@example.ru')}/matches`).expect(200)).body).toEqual([]);

    const dump = (await call(admin.cookie, 'post', `/admin/data-requests/${byMail}/export`, { userId: user!.id }).expect(200)).body as { profile: { email: string; phoneE164: string }; projects: unknown[]; orders: unknown[] };
    expect(dump.profile).toMatchObject({ email: 'Ivan.Test@Example.ru', phoneE164: '79991234567' });
    expect(dump.projects).toEqual([]);
    // Чужой пользователь, не найденный по контакту этого запроса, недоступен.
    await call(admin.cookie, 'post', `/admin/data-requests/${byMail}/export`, { userId: held!.id }).expect(404);
    await call(admin.cookie, 'post', `/admin/data-requests/${byMail}/delete`, { userId: held!.id }).expect(404);
    // Под холдом: найден по телефону, но удалять нельзя.
    const heldReq = await make('+7 999 000-00-01');
    expect((await call(admin.cookie, 'post', `/admin/data-requests/${heldReq}/delete`, { userId: held!.id }).expect(409)).body.error.code).toBe('LEGAL_HOLD');

    await call(admin.cookie, 'post', `/admin/data-requests/${byMail}/delete`, { userId: user!.id }).expect(204);
    const [gone] = await db.db.select().from(schema.users).where(eq(schema.users.id, user!.id));
    expect(gone).toMatchObject({ status: 'DELETED' });
    expect(gone!.deletedAt).not.toBeNull();
    expect((await call(admin.cookie, 'post', `/admin/data-requests/${byMail}/delete`, { userId: user!.id }).expect(409)).body.error.code).toBe('ALREADY');
    const audit = await db.db.select().from(schema.auditLog).where(eq(schema.auditLog.targetId, byMail));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['DATA_REQUEST_EXPORT', 'DATA_REQUEST_DELETE']));
  });

  it('P8.5 · ADR-131 · запрос участника сборки: ответы находятся по почте или телефону, запрос уходит создателю, ответы удаляются; чужие не трогаются', async () => {
    const [owner] = await db.db.insert(schema.users).values({ displayName: 'Создатель' }).returning({ id: schema.users.id });
    const [p] = await db.db.insert(schema.projects).values({ ownerId: owner!.id, title: 'Запись на йогу', slug: `yoga-${Date.now()}` }).returning({ id: schema.projects.id });
    const [v] = await db.db.insert(schema.projectVersions).values({ projectId: p!.id, number: 1, document: {} as never, schemaVersion: 1, sha256: `y${Date.now()}`, kind: 'PUBLISHED' }).returning({ id: schema.projectVersions.id });
    const passage = async (value: unknown) => {
      const [sess] = await db.db.insert(schema.participantSessions).values({ projectId: p!.id, versionId: v!.id }).returning({ id: schema.participantSessions.id });
      await db.db.insert(schema.answers).values({ sessionId: sess!.id, source: 'QUESTION', blockId: 'kontakty', value } as never);
      return sess!.id;
    };
    const mine = await passage({ kind: 'contacts', values: { name: 'Мария', phone: '+7 (912) 345-67-89', email: 'Maria@Mail.ru' } });
    const other = await passage({ kind: 'contacts', values: { name: 'Олег', phone: '+7 900 000-00-00' } });
    const admin = await staff('ADMIN');
    // The public form has its own test above; here the requests are put straight in (the form is limited per address and hour).
    const make = async (kind: 'ACCESS' | 'DELETE', contact: string): Promise<string> => (await db.db.insert(schema.dataSubjectRequests).values({ kind, subjectContact: contact, details: 'Удалите мои данные из сборки', dueAt: new Date(Date.now() + 10 * 86_400_000) }).returning({ id: schema.dataSubjectRequests.id }))[0]!.id;
    const byPhone = await make('DELETE', '89123456789');
    const found = (await call(admin.cookie, 'get', `/admin/data-requests/${byPhone}/participants`).expect(200)).body as Array<{ projectId: string; projectTitle: string; sessions: number }>;
    expect(found).toEqual([expect.objectContaining({ projectId: p!.id, projectTitle: 'Запись на йогу', sessions: 1 })]);
    const byMail = await make('ACCESS', 'maria@mail.ru');
    expect(((await call(admin.cookie, 'get', `/admin/data-requests/${byMail}/participants`).expect(200)).body as unknown[]).length).toBe(1);

    await call(admin.cookie, 'post', `/admin/data-requests/${byPhone}/forward`, { projectId: p!.id }).expect(204);
    const [note] = await db.db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, owner!.id), eq(schema.notifications.kind, 'data-request')));
    expect(note!.title).toBe('Участник сборки «Запись на йогу» просит удалить его данные');
    expect(note!.body).toContain('89123456789');
    expect(note!.body).toContain('10 рабочих дней');
    await call(admin.cookie, 'post', `/admin/data-requests/${byPhone}/forward`, { projectId: 'chuzhaya' }).expect(404);

    expect((await call(admin.cookie, 'post', `/admin/data-requests/${byPhone}/delete-participant`, { projectId: p!.id }).expect(200)).body).toEqual({ deleted: 1 });
    expect(await db.db.select().from(schema.participantSessions).where(eq(schema.participantSessions.id, mine))).toHaveLength(0);
    expect(await db.db.select().from(schema.participantSessions).where(eq(schema.participantSessions.id, other))).toHaveLength(1);
    const audit = await db.db.select().from(schema.auditLog).where(eq(schema.auditLog.targetId, byPhone));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['DATA_REQUEST_FORWARDED', 'DATA_REQUEST_PARTICIPANT_DELETED']));
  });

  it('P8.5 · десять рабочих дней пропускают субботы и воскресенья (по московскому времени)', () => {
    // Monday 9 November 2026, 10:00 MSK → Monday 23 November (на этой неделе праздников нет).
    expect(addWorkingDays(new Date('2026-11-09T07:00:00Z'), 10).toISOString()).toBe('2026-11-23T07:00:00.000Z');
    // Friday → the next working day is Monday.
    expect(addWorkingDays(new Date('2026-11-06T07:00:00Z'), 1).toISOString()).toBe('2026-11-09T07:00:00.000Z');
  });
});
