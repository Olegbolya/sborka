import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocument, type ProjectDocument } from '@blokum/schema';
import { ApiError } from '../lib/api-browser';
import { toSaveFailure } from '../lib/editor/remote';
import {
  AUTOSAVE_DELAY_MS,
  KEEPALIVE_LIMIT_BYTES,
  RETRY_DELAY_MS,
  type DraftQueue,
  type QueuedDraft,
  type SaveFailure,
  SaveError,
  Saver,
  type SaverDeps,
} from '../lib/editor/saver';

const doc = (title: string): ProjectDocument => createDocument({ title });

function setup(revision = 5) {
  const queue = new Map<string, QueuedDraft>();
  const timers: Array<{ fn: () => void; ms: number; id: number; live: boolean }> = [];
  let online = true;
  const sent: Array<{ title: string; ifMatch: string; keepalive: boolean }> = [];
  let next: (() => Promise<number>) | null = null;
  let revCounter = revision;
  const authLost = vi.fn();
  const q: DraftQueue = {
    put: (id, d) => Promise.resolve(void queue.set(id, d)),
    get: (id) => Promise.resolve(queue.get(id) ?? null),
    remove: (id) => Promise.resolve(void queue.delete(id)),
  };
  const deps: SaverDeps = {
    send: (_id, d, ifMatch, keepalive) => {
      sent.push({ title: d.meta.title, ifMatch, keepalive });
      return next ? next() : Promise.resolve(++revCounter);
    },
    queue: q,
    online: () => online,
    setTimer: (fn, ms) => {
      const t = { fn, ms, id: timers.length, live: true };
      timers.push(t);
      return t.id;
    },
    clearTimer: (h) => {
      const t = timers[h as number];
      if (t) t.live = false;
    },
    onAuthLost: authLost,
  };
  const saver = new Saver('p1', deps, revision);
  const fire = async () => {
    const t = [...timers].reverse().find((x) => x.live);
    if (!t) throw new Error('нет таймера');
    t.live = false;
    t.fn();
    await vi.waitFor(() => expect(saver.state.status).not.toBe('saving'));
  };
  return {
    saver,
    queue,
    timers,
    sent,
    authLost,
    fire,
    setOnline: (v: boolean) => (online = v),
    failNext: (f: SaveFailure) => (next = () => Promise.reject(new SaveError(f))),
    okNext: () => (next = null),
  };
}

describe('E-17 · автосохранение', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it('E-17 · через 1 секунду после изменения: «Сохраняю…» → «Сохранено», версия растёт, очередь пуста', async () => {
    s.saver.changed(doc('A'));
    expect(s.saver.state.text).toBe('Сохраняю…');
    expect(s.timers.at(-1)!.ms).toBe(AUTOSAVE_DELAY_MS);
    await s.fire();
    expect(s.saver.state).toMatchObject({ status: 'saved', text: 'Сохранено', revision: 6 });
    expect(s.sent).toEqual([{ title: 'A', ifMatch: '5', keepalive: false }]);
    expect(s.queue.size).toBe(0);
  });

  it('E-17 · серия правок — один запрос с последним документом (таймер сбрасывается)', async () => {
    s.saver.changed(doc('A'));
    s.saver.changed(doc('B'));
    s.saver.changed(doc('C'));
    expect(s.timers.filter((t) => t.live)).toHaveLength(1);
    await s.fire();
    expect(s.sent.map((x) => x.title)).toEqual(['C']);
  });

  it('E-17 · правка во время отправки уходит следующим запросом на новой версии', async () => {
    let release!: (n: number) => void;
    const gate = new Promise<number>((r) => (release = r));
    let first = true;
    const original = s.saver;
    // First request hangs until released; the second goes through.
    (original as unknown as { deps: SaverDeps }).deps.send = (_i, d, m) => {
      s.sent.push({ title: d.meta.title, ifMatch: m, keepalive: false });
      if (first) {
        first = false;
        return gate;
      }
      return Promise.resolve(7);
    };
    original.changed(doc('A'));
    const flushing = original.flush();
    original.changed(doc('B'));
    release(6);
    await flushing;
    await vi.waitFor(() => expect(original.state.status).toBe('saved'));
    expect(s.sent.map((x) => [x.title, x.ifMatch])).toEqual([
      ['A', '5'],
      ['B', '6'],
    ]);
    expect(original.state.revision).toBe(7);
  });

  it('E-17 · flush отправляет сразу, не дожидаясь таймера; без изменений ничего не шлёт', async () => {
    await s.saver.flush();
    expect(s.sent).toHaveLength(0);
    s.saver.changed(doc('A'));
    await s.saver.flush();
    expect(s.sent).toHaveLength(1);
    expect(s.saver.state.status).toBe('saved');
  });

  it('E-17 · нет сети: правки в очереди, «Нет сети — изменения сохранятся», после возврата сети всё отправлено', async () => {
    s.setOnline(false);
    s.saver.changed(doc('A'));
    s.saver.changed(doc('B'));
    await s.fire();
    expect(s.saver.state).toMatchObject({ status: 'offline', text: 'Нет сети — изменения сохранятся' });
    expect(s.sent).toHaveLength(0);
    expect(s.queue.get('p1')).toMatchObject({ baseRevision: 5 });
    expect(s.queue.get('p1')!.document.meta.title).toBe('B');
    expect(s.timers.at(-1)!.ms).toBe(RETRY_DELAY_MS);

    s.setOnline(true);
    s.saver.networkBack();
    await s.fire();
    expect(s.saver.state.status).toBe('saved');
    expect(s.sent.map((x) => x.title)).toEqual(['B']);
    expect(s.queue.size).toBe(0);
  });

  it('E-17 · запрос не дошёл (сеть пропала посреди работы): очередь и повтор', async () => {
    s.failNext({ kind: 'network' });
    s.saver.changed(doc('A'));
    await s.fire();
    expect(s.saver.state.status).toBe('offline');
    expect(s.queue.get('p1')!.document.meta.title).toBe('A');
    s.okNext();
    await s.fire(); // the retry timer
    expect(s.saver.state.status).toBe('saved');
    expect(s.queue.size).toBe(0);
  });

  it('E-17 · события сети: networkLost показывает офлайн, только если есть несохранённое', () => {
    s.saver.networkLost();
    expect(s.saver.state.status).toBe('saved');
    s.saver.changed(doc('A'));
    s.saver.networkLost();
    expect(s.saver.state.status).toBe('offline');
    s.saver.networkBack();
    expect(s.saver.state.status).toBe('saving');
  });

  it('E-17 · сервер отклонил документ: понятная ошибка, повторная правка пробует снова', async () => {
    s.failNext({ kind: 'rejected', message: 'слишком большая' });
    s.saver.changed(doc('A'));
    await s.fire();
    expect(s.saver.state).toMatchObject({ status: 'error', text: 'Не удалось сохранить: слишком большая' });
    s.okNext();
    s.saver.changed(doc('B'));
    await s.fire();
    expect(s.saver.state.status).toBe('saved');
  });

  it('E-17 · сеанс закончился: правки в очереди на устройстве, редактор уведомлён', async () => {
    s.failNext({ kind: 'auth' });
    s.saver.changed(doc('A'));
    await s.fire();
    expect(s.authLost).toHaveBeenCalled();
    expect(s.saver.state.status).toBe('error');
    expect(s.queue.get('p1')!.document.meta.title).toBe('A');
  });

  it('E-17 · уход со страницы: очередь + запрос keepalive, если документ небольшой', () => {
    s.saver.changed(doc('A'));
    s.saver.leaving();
    expect(s.queue.get('p1')).toBeDefined();
    expect(s.sent).toEqual([{ title: 'A', ifMatch: '5', keepalive: true }]);
  });

  it('E-17 · уход со страницы: большой документ — только очередь; без изменений — ничего; офлайн — только очередь', () => {
    const big = doc('Большой');
    big.meta.description = 'я'.repeat(400);
    for (let i = 0; i < KEEPALIVE_LIMIT_BYTES / 50; i++) big.variables.push({ id: `v${i}`, name: `Переменная ${i}`, type: 'text', initial: 'я'.repeat(100), saveToAnswers: false } as never);
    s.saver.leaving();
    expect(s.queue.size).toBe(0);
    s.saver.changed(big);
    s.saver.leaving();
    expect(s.queue.size).toBe(1);
    expect(s.sent).toHaveLength(0);
    s.queue.clear();
    s.saver.changed(doc('мал'));
    s.setOnline(false);
    s.saver.leaving();
    expect(s.queue.size).toBe(1);
    expect(s.sent).toHaveLength(0);
  });

  it('E-17 · dispose гасит таймер и подписки', () => {
    const seen = vi.fn();
    s.saver.subscribe(seen);
    s.saver.changed(doc('A'));
    s.saver.dispose();
    expect(s.timers.at(-1)!.live).toBe(false);
    s.saver.changed(doc('B'));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('E-17 · несохранённое из очереди после перезагрузки уходит на своей базовой версии', async () => {
    s.saver.restore({ document: doc('Из очереди'), baseRevision: 5 });
    await s.fire();
    expect(s.sent).toEqual([{ title: 'Из очереди', ifMatch: '5', keepalive: false }]);
    expect(s.saver.state.status).toBe('saved');
  });
});

describe('E-18 · конфликт двух вкладок', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    s.failNext({ kind: 'conflict', currentRevision: 9 });
  });

  it('E-18 · устаревшая запись: статус «конфликт», свои правки остаются на устройстве, автосохранение стоит', async () => {
    s.saver.changed(doc('Моя'));
    await s.fire();
    expect(s.saver.state).toMatchObject({ status: 'conflict', revision: 9 });
    expect(s.queue.get('p1')!.document.meta.title).toBe('Моя');
    const before = s.sent.length;
    s.saver.changed(doc('Ещё правка'));
    await s.saver.flush();
    expect(s.sent).toHaveLength(before);
    expect(s.saver.state.status).toBe('conflict');
  });

  it('E-18 «Перезаписать»: уходит самая новая правка с If-Match: *, статус «Сохранено»', async () => {
    s.saver.changed(doc('Моя'));
    await s.fire();
    s.okNext();
    s.saver.changed(doc('Ещё правка'));
    await s.saver.overwriteServer();
    expect(s.sent.at(-1)).toEqual({ title: 'Ещё правка', ifMatch: '*', keepalive: false });
    expect(s.saver.state.status).toBe('saved');
    expect(s.queue.size).toBe(0);
    s.saver.changed(doc('Дальше'));
    await s.fire();
    expect(s.sent.at(-1)!.ifMatch).toBe(String(s.saver.state.revision - 1));
  });

  it('E-18 «Загрузить свежую»: локальные правки забыты, очередь пуста, версия — серверная', async () => {
    s.saver.changed(doc('Моя'));
    await s.fire();
    await s.saver.acceptServerVersion(9);
    expect(s.saver.state).toMatchObject({ status: 'saved', revision: 9 });
    expect(s.queue.size).toBe(0);
    s.okNext();
    await s.saver.flush();
    expect(s.sent).toHaveLength(1); // nothing new was sent
    s.saver.changed(doc('Следующая'));
    await s.fire();
    expect(s.sent.at(-1)!.ifMatch).toBe('9');
  });

  it('E-18 · overwriteServer вне конфликта ничего не делает', async () => {
    const t = setup();
    await t.saver.overwriteServer();
    expect(t.sent).toHaveLength(0);
  });
});

describe('E-17/E-18 · разбор ответов сервера', () => {
  it('409 REVISION_CONFLICT → конфликт с текущей версией; 401 → вход; 5xx и обрыв → сеть; остальное → отказ', () => {
    expect(toSaveFailure(new ApiError(409, 'REVISION_CONFLICT', 'м', 12))).toEqual({ kind: 'conflict', currentRevision: 12 });
    expect(toSaveFailure(new ApiError(409, 'REVISION_CONFLICT', 'м'))).toEqual({ kind: 'conflict', currentRevision: 0 });
    expect(toSaveFailure(new ApiError(401, 'X', 'м'))).toEqual({ kind: 'auth' });
    expect(toSaveFailure(new ApiError(502, 'X', 'м'))).toEqual({ kind: 'network' });
    expect(toSaveFailure(new TypeError('Failed to fetch'))).toEqual({ kind: 'network' });
    expect(toSaveFailure(new ApiError(400, 'INVALID_DOCUMENT', 'Сборка не прошла проверку'))).toEqual({ kind: 'rejected', message: 'Сборка не прошла проверку' });
  });
});
