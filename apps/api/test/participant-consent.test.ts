import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { schema } from '@blokum/db';
import { createBlock, pdFieldsOf, screensWithoutConsent, type ProjectDocument } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import { PlaySessionsService } from '../src/play/play-sessions.service.js';
import { operatorInfoProblem } from '../src/projects/projects.service.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

/** ADR-131 · находки ревью К-1…К-3: текст согласия участника, проверка ПД при публикации, согласие на сервере. */
describe('PL-23 · B-20 · согласие участника на обработку ПД (ADR-131)', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;
  const sentCodes: { phone: string; code: string }[] = [];
  let phoneCounter = 0;
  const OPERATOR = { name: 'ИП Петрова Анна Сергеевна', email: 'anna@studio.ru', inn: '123456789012', purpose: 'Запись на пробное занятие', retentionPeriod: '6 месяцев' };

  const login = async (): Promise<string> => {
    await db.db.delete(schema.otpRequests);
    const phone = `+7903${String(5000000 + ++phoneCounter).slice(-7)}`;
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const { code } = sentCodes.pop()!;
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code }).expect(200);
    return ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
  };
  const api = (cookie: string, method: 'get' | 'post' | 'put' | 'patch', url: string, body?: unknown) => {
    const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
    return body === undefined ? r : r.send(body as object);
  };
  const open = (url: string, body: unknown = {}) => request(t.http()).post(`/${API_PREFIX}${url}`).set('X-Blokum-CSRF', '1').send(body as object);

  /** A draft with a text field «телефон» (B-13) and, if asked, the consent checkbox on the same screen. */
  const draft = async (cookie: string, withConsent: boolean) => {
    const created = (await api(cookie, 'post', '/projects', { title: 'Пробное занятие' }).expect(200)).body as { id: string; document: ProjectDocument; draftVersionNumber: number };
    const doc = created.document;
    const phone = createBlock('textInput');
    if (phone.type !== 'textInput') throw new Error('тип');
    phone.props.semantic = 'phone';
    phone.name = 'Телефон';
    const consent = createBlock('consent');
    doc.screens[0]!.blocks.push(phone, ...(withConsent ? [consent] : []), createBlock('button'));
    await api(cookie, 'put', `/projects/${created.id}/draft`, { document: doc }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    return { id: created.id, phoneId: phone.id, consentId: consent.id, doc };
  };
  const operatorReady = async (cookie: string, id: string) => {
    await api(cookie, 'patch', `/projects/${id}/operator-info`, OPERATOR).expect(200);
    await api(cookie, 'post', `/projects/${id}/dpa-accept`).expect(200);
    await api(cookie, 'post', `/projects/${id}/operator-ack`).expect(200);
  };
  const answer = (sid: string, blockId: string, value: unknown) => open(`/play/sessions/${sid}/answers`, { blockId, value, clientEventId: `e${Math.random().toString(36).slice(2, 12)}`, clientTs: Date.now() });
  const start = async (id: string) => ((await open(`/play/${id}/sessions`).expect(201)).body as { sessionId: string }).sessionId;
  const answersOf = (sid: string) => db.db.select().from(schema.answers).where(eq(schema.answers.sessionId, sid));
  const eventsOf = async (sid: string) => (await db.db.select().from(schema.playEvents).where(eq(schema.playEvents.sessionId, sid))).map((e) => (e.payload as { kind?: string }).kind);

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

  it('PL-23 · pdFieldsOf и screensWithoutConsent: поле «телефон» (B-13) — это ПД; экран с ПД без B-20 найден', () => {
    const doc = { screens: [{ id: 's1', name: 'Анкета', blocks: [] as ProjectDocument['screens'][number]['blocks'] }] };
    const phone = createBlock('textInput');
    if (phone.type !== 'textInput') throw new Error('тип');
    phone.props.semantic = 'phone';
    doc.screens[0]!.blocks.push(phone, createBlock('contacts'));
    expect(pdFieldsOf(doc)).toEqual(['name', 'phone']);
    expect(screensWithoutConsent(doc)).toEqual([{ id: 's1', name: 'Анкета' }]);
    doc.screens[0]!.blocks.push(createBlock('consent'));
    expect(screensWithoutConsent(doc)).toEqual([]);
  });

  it('PL-23 · operatorInfoProblem: почта, ИНН 10 или 12 цифр, цель и срок обязательны', () => {
    expect(operatorInfoProblem(OPERATOR)).toBeNull();
    expect(operatorInfoProblem({ ...OPERATOR, inn: undefined })).toBeNull();
    expect(operatorInfoProblem({ ...OPERATOR, email: 'нет' })).toBe('Укажите почту для обращений участников, например name@mail.ru.');
    expect(operatorInfoProblem({ ...OPERATOR, inn: '12345' })).toBe('ИНН — 10 цифр у организации или 12 цифр у ИП и физического лица.');
    expect(operatorInfoProblem({ ...OPERATOR, purpose: '' })).toBe('Опишите цель обработки данных (от 3 до 500 символов).');
    expect(operatorInfoProblem(null)).toBe('Заполните сведения об операторе.');
  });

  it('PL-23 · поле «телефон» без сведений об операторе не публикуется; неверные сведения не сохраняются; без B-20 на экране — отказ', async () => {
    const cookie = await login();
    const p = await draft(cookie, false);
    const refused = await api(cookie, 'post', `/projects/${p.id}/publish`).expect(400);
    expect(refused.body.error.code).toBe('OPERATOR_INFO_REQUIRED');
    const bad = await api(cookie, 'patch', `/projects/${p.id}/operator-info`, { ...OPERATOR, inn: '12' }).expect(400);
    expect(bad.body.error.code).toBe('INVALID_OPERATOR_INFO');
    await operatorReady(cookie, p.id);
    const noConsent = await api(cookie, 'post', `/projects/${p.id}/publish`).expect(400);
    expect(noConsent.body.error).toMatchObject({ code: 'CONSENT_BLOCK_REQUIRED' });
    expect(noConsent.body.error.message).toContain('«Согласие на обработку ПД»');
  });

  it('B-20 · текст согласия сборки: оператор, ИНН, цель, перечень именно этих ПД и срок; без подстановок; сборка без ПД — 404', async () => {
    const cookie = await login();
    const p = await draft(cookie, true);
    await operatorReady(cookie, p.id);
    await api(cookie, 'post', `/projects/${p.id}/publish`).expect(200);
    const text = (await request(t.http()).get(`/${API_PREFIX}/play/${p.id}/consent`).expect(200)).body as { title: string; version: number; markdown: string };
    expect(text.title).toBe('Согласие на обработку персональных данных — «Пробное занятие»');
    for (const piece of ['ИП Петрова Анна Сергеевна', 'ИНН: 123456789012', 'anna@studio.ru', 'Запись на пробное занятие', 'номер телефона', '6 месяцев', 'Участник сборки «Пробное занятие»']) expect(text.markdown).toContain(piece);
    expect(text.markdown).not.toContain('{{');
    expect(text.markdown).not.toContain('Шаблон');
    expect(text.version).toBeGreaterThanOrEqual(1);

    const plain = (await api(cookie, 'post', '/projects', { title: 'Без ПД' }).expect(200)).body as { id: string; document: ProjectDocument; draftVersionNumber: number };
    plain.document.screens[0]!.blocks.push(createBlock('button'));
    await api(cookie, 'put', `/projects/${plain.id}/draft`, { document: plain.document }).set('If-Match', String(plain.draftVersionNumber)).expect(200);
    await api(cookie, 'post', `/projects/${plain.id}/publish`).expect(200);
    await request(t.http()).get(`/${API_PREFIX}/play/${plain.id}/consent`).expect(404);
  });

  it('B-20 · сервер не хранит телефон без отмеченного согласия; с согласием — хранит, и согласие записано с версией сборки', async () => {
    const cookie = await login();
    const p = await draft(cookie, true);
    await operatorReady(cookie, p.id);
    await api(cookie, 'post', `/projects/${p.id}/publish`).expect(200);

    // The browser is bypassed: the phone is sent, the consent never ticked.
    const sid = await start(p.id);
    await answer(sid, p.phoneId, { kind: 'text', value: '+79001234567' }).expect(200);
    await open(`/play/sessions/${sid}/complete`).expect(200);
    expect((await answersOf(sid)).filter((a) => a.blockId === p.phoneId)).toHaveLength(0);
    expect(await eventsOf(sid)).toContain('PD_DROPPED_NO_CONSENT');

    const ok = await start(p.id);
    await answer(ok, p.phoneId, { kind: 'text', value: '+79007654321' }).expect(200);
    await answer(ok, p.consentId, { kind: 'consent', value: true }).expect(200);
    await open(`/play/sessions/${ok}/complete`).expect(200);
    expect((await answersOf(ok)).find((a) => a.blockId === p.phoneId)?.value).toEqual({ kind: 'text', value: '+79007654321' });
    const [given] = await db.db.select().from(schema.playEvents).where(and(eq(schema.playEvents.sessionId, ok)));
    expect(await eventsOf(ok)).toContain('PD_CONSENT_GIVEN');
    expect(given).toBeDefined();
    // ADR-131 · the phone stays in the table of answers: the message to the creator (kept longer) does not carry it.
    const texts = [...(await db.db.select({ body: schema.notifications.body }).from(schema.notifications)), ...(await db.db.select({ body: schema.passageDigestQueue.body }).from(schema.passageDigestQueue))].map((r) => r.body);
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.join('\n')).not.toContain('+79007654321');
    expect(texts.join('\n')).toContain('персональные данные — в таблице ответов');
  });

  it('B-20 · брошенное прохождение: через сутки телефон без согласия удаляется, свежее и согласованное не трогаются', async () => {
    const cookie = await login();
    const p = await draft(cookie, true);
    await operatorReady(cookie, p.id);
    await api(cookie, 'post', `/projects/${p.id}/publish`).expect(200);
    const left = await start(p.id);
    await answer(left, p.phoneId, { kind: 'text', value: '+79000000001' }).expect(200);
    const agreed = await start(p.id);
    await answer(agreed, p.phoneId, { kind: 'text', value: '+79000000002' }).expect(200);
    await answer(agreed, p.consentId, { kind: 'consent', value: true }).expect(200);
    const service = t.app.get(PlaySessionsService);
    expect(await service.purgeUnconsented(new Date())).toBe(0);
    await service.purgeUnconsented(new Date(Date.now() + 25 * 3_600_000));
    expect((await answersOf(left)).filter((a) => a.blockId === p.phoneId)).toHaveLength(0);
    expect((await answersOf(agreed)).filter((a) => a.blockId === p.phoneId)).toHaveLength(1);
  });
});
