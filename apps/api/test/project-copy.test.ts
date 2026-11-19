import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { schema } from '@blokum/db';
import { createBlock, createId, createScreen, type ProjectDocument } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

let phoneCounter = 0;

/** ADR-120 · «Скопировать себе»: автор разрешает копирование опубликованной сборки, любой вошедший получает полную копию. */
describe('ADR-120 · копирование сборки', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;
  const codes: { phone: string; code: string }[] = [];
  const otp: OtpSender = {
    sendCode: vi.fn((phone: string, code: string) => {
      codes.push({ phone, code });
      return Promise.resolve();
    }),
  };
  const captcha: CaptchaVerifier = { verify: () => Promise.resolve(true) };

  const login = async (): Promise<{ cookie: string; userId: string }> => {
    await db.db.delete(schema.otpRequests);
    const phone = `+7901${String(1000000 + ++phoneCounter).slice(-7)}`;
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code: codes.pop()!.code }).expect(200);
    const cookie = ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
    const [u] = await db.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phoneE164, phone));
    return { cookie, userId: u!.id };
  };
  const call = (cookie: string, method: 'post' | 'put' | 'patch' | 'get' | 'delete', url: string, body?: unknown) => {
    const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
    return body === undefined ? r : r.send(body as object);
  };
  const subscribe = async (userId: string, planCode: 'AUTHOR' | 'PLUS' | 'PRO') => {
    await db.db.insert(schema.subscriptions).values({ userId, planCode, period: 'MONTH', status: 'ACTIVE', currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 29 * 86_400_000) });
  };

  /** A published project of `cookie` with a scored question, two screens and a picture on the background of the first screen. */
  const published = async (cookie: string): Promise<{ id: string; slug: string; mediaId: string; png: Buffer }> => {
    const png = await sharp({ create: { width: 6, height: 6, channels: 3, background: '#2E7D32' } }).png().toBuffer();
    const up = await request(t.http()).post(`/${API_PREFIX}/media`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').attach('file', png, { filename: 'fon.png', contentType: 'image/png' }).expect(201);
    const mediaId = up.body.id as string;
    const created = (await call(cookie, 'post', '/projects', { title: 'Квиз для ролика' }).expect(200)).body as { id: string; slug: string; document: ProjectDocument; draftVersionNumber: number };
    const doc = created.document;
    const q = createBlock('singleChoice', { name: 'Вопрос' });
    if (q.type === 'singleChoice') {
      q.props.options[0]!.correct = true;
      q.props.options[0]!.score = 5;
    }
    doc.screens[0]!.blocks.push(q, createBlock('button'));
    doc.screens[0]!.background = [{ kind: 'media', media: { source: 'media', id: mediaId }, fit: 'cover', focal: { x: 0.5, y: 0.5 }, scale: 1 }];
    doc.screens.push(createScreen('Итог'));
    await call(cookie, 'put', `/projects/${created.id}/draft`, { document: doc }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    await call(cookie, 'post', `/projects/${created.id}/publish`).expect(200);
    return { id: created.id, slug: created.slug, mediaId, png };
  };

  beforeAll(async () => {
    try {
      db = await createTestDb();
      t = await startTestApp({ db: db.db, otpSender: otp, captchaVerifier: captcha });
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  it('ADR-120 · по умолчанию выключено; на «Старте» включить нельзя (402), с «Автора» — можно; кнопка в плеере — только когда включено', async () => {
    const author = await login();
    const p = await published(author.cookie);
    const before = (await call(author.cookie, 'get', `/projects/${p.id}/access-settings`).expect(200)).body;
    expect(before).toMatchObject({ copyAllowed: false });
    expect(before.allowCopy).toBeUndefined();
    expect((await request(t.http()).get(`/${API_PREFIX}/play/${p.slug}`).expect(200)).body.copyable).toBe(false);
    const refused = await call(author.cookie, 'patch', `/projects/${p.id}/access-settings`, { allowCopy: true }).expect(402);
    expect(refused.body.error).toMatchObject({ code: 'PLAN_LIMIT', message: 'Разрешать копирование сборки можно на тарифе «Автор» и выше.' });
    await call(author.cookie, 'patch', `/projects/${p.id}/access-settings`, { allowCopy: 'да' }).expect(400);

    const other = await login();
    await call(other.cookie, 'post', '/projects/copy', { slug: p.slug }).expect(404);

    await subscribe(author.userId, 'AUTHOR');
    expect((await call(author.cookie, 'get', `/projects/${p.id}/access-settings`).expect(200)).body.copyAllowed).toBe(true);
    await call(author.cookie, 'patch', `/projects/${p.id}/access-settings`, { allowCopy: true }).expect(200);
    expect((await request(t.http()).get(`/${API_PREFIX}/play/${p.slug}`).expect(200)).body.copyable).toBe(true);
  });

  it('ADR-120 · копия — полная и независимая: экраны, ответы, баллы, фон; файлы скопированы в аккаунт копирующего и живут после удаления у автора', async () => {
    const author = await login();
    await subscribe(author.userId, 'PLUS');
    const p = await published(author.cookie);
    await call(author.cookie, 'patch', `/projects/${p.id}/access-settings`, { allowCopy: true }).expect(200);

    // The copier is on «Старт»: copying needs no tariff.
    const copier = await login();
    const made = (await call(copier.cookie, 'post', '/projects/copy', { slug: p.slug }).expect(200)).body as { id: string; title: string; document: ProjectDocument; status: string };
    expect(made.id).not.toBe(p.id);
    expect(made.title).toBe('Квиз для ролика');
    expect(made.status).toBe('DRAFT');
    const [row] = await db.db.select().from(schema.projects).where(eq(schema.projects.id, made.id));
    expect(row).toMatchObject({ ownerId: copier.userId, sourceLabel: 'copy' });
    expect(row!.settings).toEqual({});

    const doc = made.document;
    expect(doc.screens).toHaveLength(2);
    const q = doc.screens[0]!.blocks.find((b) => b.type === 'singleChoice')!;
    expect(q.type === 'singleChoice' && q.props.options[0]).toMatchObject({ correct: true, score: 5 });

    // The picture is the copier's own now: another id, owned by the copier, the same bytes on disk.
    const bg = doc.screens[0]!.background[0]!;
    expect(bg.kind).toBe('media');
    const copiedId = bg.kind === 'media' && bg.media.source === 'media' ? bg.media.id : '';
    expect(copiedId).not.toBe(p.mediaId);
    const [m] = await db.db.select().from(schema.media).where(eq(schema.media.id, copiedId));
    expect(m).toMatchObject({ ownerId: copier.userId, kind: 'IMAGE' });
    const file = await call(copier.cookie, 'get', `/media/${copiedId}/file`).expect(200);
    const original = (await call(author.cookie, 'get', `/media/${p.mediaId}/file`).expect(200)).body as Buffer;
    expect(Buffer.compare(file.body as Buffer, original)).toBe(0);

    // The author deletes the picture: the copy keeps its own.
    await call(author.cookie, 'delete', `/media/${p.mediaId}?confirm=true`).expect(200);
    expect(existsSync(path.join(os.tmpdir(), author.userId, p.mediaId))).toBe(false);
    const still = await call(copier.cookie, 'get', `/media/${copiedId}/file`).expect(200);
    expect(Buffer.compare(still.body as Buffer, original)).toBe(0);
    expect(readFileSync(path.join(os.tmpdir(), copier.userId, copiedId)).length).toBeGreaterThan(0);

    // The copy is independent: the author's project and its answers are not touched.
    const [authorProject] = await db.db.select({ ownerId: schema.projects.ownerId }).from(schema.projects).where(eq(schema.projects.id, p.id));
    expect(authorProject!.ownerId).toBe(author.userId);
  });

  it('ADR-120 · перекодированная картинка (исходник удалён, остался <id>.webp и варианты по ширине) копируется со всеми файлами', async () => {
    const author = await login();
    await subscribe(author.userId, 'AUTHOR');
    const p = await published(author.cookie);
    // As the worker leaves it: the source is gone, the re-encoded file and a width variant lie next to it.
    const id = createId();
    const dir = path.join(os.tmpdir(), author.userId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${id}.webp`), Buffer.from('webp-original'));
    writeFileSync(path.join(dir, `${id}_w320.webp`), Buffer.from('webp-320'));
    await db.db.insert(schema.media).values({ id, ownerId: author.userId, kind: 'IMAGE', status: 'READY', mime: 'image/webp', bytes: 13, sha256: 'x'.repeat(64), variants: { original: path.join(dir, `${id}.webp`), w320: path.join(dir, `${id}_w320.webp`) } });
    const [proj] = await db.db.select({ v: schema.projects.publishedVersionId }).from(schema.projects).where(eq(schema.projects.id, p.id));
    const [ver] = await db.db.select({ d: schema.projectVersions.document }).from(schema.projectVersions).where(eq(schema.projectVersions.id, proj!.v!));
    const doc = ver!.d as unknown as ProjectDocument;
    doc.meta.ogImage = { source: 'media', id };
    await db.db.update(schema.projectVersions).set({ document: doc }).where(eq(schema.projectVersions.id, proj!.v!));
    await call(author.cookie, 'patch', `/projects/${p.id}/access-settings`, { allowCopy: true }).expect(200);

    const copier = await login();
    const made = (await call(copier.cookie, 'post', '/projects/copy', { slug: p.slug }).expect(200)).body as { document: ProjectDocument };
    const og = made.document.meta.ogImage;
    const newId = og?.source === 'media' ? og.id : '';
    expect(newId).not.toBe(id);
    const [m] = await db.db.select().from(schema.media).where(eq(schema.media.id, newId));
    const cdir = path.join(os.tmpdir(), copier.userId);
    expect(m!.variants).toEqual({ original: path.join(cdir, `${newId}.webp`), w320: path.join(cdir, `${newId}_w320.webp`) });
    expect(readFileSync(path.join(cdir, `${newId}.webp`), 'utf8')).toBe('webp-original');
    expect(readFileSync(path.join(cdir, `${newId}_w320.webp`), 'utf8')).toBe('webp-320');
    expect(existsSync(path.join(cdir, newId))).toBe(false);
    expect(String((await call(copier.cookie, 'get', `/media/${newId}/file`).expect(200)).body as Buffer)).toBe('webp-original');
  });

  it('ADR-120 · не копируются: черновик, сборка под паролем, после выключения галочки, после перехода автора на «Старт»; ответы участников не уходят в копию', async () => {
    const author = await login();
    await subscribe(author.userId, 'AUTHOR');
    const p = await published(author.cookie);
    await call(author.cookie, 'patch', `/projects/${p.id}/access-settings`, { allowCopy: true }).expect(200);
    const copier = await login();
    await call(copier.cookie, 'post', '/projects/copy', { slug: 'net-takoj-sborki' }).expect(404);
    await call(copier.cookie, 'post', '/projects/copy', { slug: '../x' }).expect(400);
    await request(t.http()).post(`/${API_PREFIX}/projects/copy`).set('X-Blokum-CSRF', '1').send({ slug: p.slug }).expect(401);

    // With a password the project is not offered and not copied.
    await call(author.cookie, 'patch', `/projects/${p.id}/access-settings`, { password: 'sekret12' }).expect(200);
    await call(copier.cookie, 'post', '/projects/copy', { slug: p.slug }).expect(404);
    await call(author.cookie, 'patch', `/projects/${p.id}/access-settings`, { password: '' }).expect(200);
    await call(copier.cookie, 'post', '/projects/copy', { slug: p.slug }).expect(200);

    // Switched off — no more copies.
    await call(author.cookie, 'patch', `/projects/${p.id}/access-settings`, { allowCopy: false }).expect(200);
    const off = await call(copier.cookie, 'post', '/projects/copy', { slug: p.slug }).expect(404);
    expect(off.body.error.message).toContain('автор не разрешил копирование');
    await call(author.cookie, 'patch', `/projects/${p.id}/access-settings`, { allowCopy: true }).expect(200);

    // The author is back on «Старт»: the setting stays, but copying stops and the button goes away.
    await db.db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, author.userId));
    await call(copier.cookie, 'post', '/projects/copy', { slug: p.slug }).expect(404);
    expect((await request(t.http()).get(`/${API_PREFIX}/play/${p.slug}`).expect(200)).body.copyable).toBe(false);

    // Nothing of the participants' answers is in a copy: the copies have no passages.
    const copies = await db.db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.ownerId, copier.userId), eq(schema.projects.sourceLabel, 'copy')));
    expect(copies.length).toBe(1);
    for (const c of copies) expect(await db.db.select().from(schema.participantSessions).where(eq(schema.participantSessions.projectId, c.id))).toHaveLength(0);
  });
});
