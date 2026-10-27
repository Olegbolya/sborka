import { describe, expect, it } from 'vitest';
import { type AnswerValue } from '@blokum/engine';
import { ApiError } from '../lib/api-browser';
import { PlayClient, type PlayTransport, type QueueStorage } from '../lib/play/play-client';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

const memory = (): QueueStorage & { value: string | null } => {
  const s = { value: null as string | null, read: () => s.value, write: (v: string) => void (s.value = v) };
  return s;
};

/** A transport that fails as told: `network` drops the call, a number answers with that status. */
function transport(plan: Array<'ok' | 'network' | number> = []): PlayTransport & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    call<T>(method: 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
      calls.push({ method, path, body });
      const step = plan.shift() ?? 'ok';
      if (step === 'network') return Promise.reject(new TypeError('Failed to fetch'));
      if (typeof step === 'number') return Promise.reject(new ApiError(step, 'ERR', 'Ошибка'));
      if (path.endsWith('/complete')) return Promise.resolve({ score: 3, max: 5, correct: 1, keyed: 2, result: { key: 'Итог', screenId: 'ekran_itog' } } as T);
      if (path.endsWith('/check')) return Promise.resolve({ correct: true, correctOptionIds: [], score: 3 } as T);
      return Promise.resolve({} as T);
    },
  };
}

const timers = () => {
  const pending: Array<{ fn: () => void; ms: number }> = [];
  return { pending, setTimer: (fn: () => void, ms: number) => pending.push({ fn, ms }) - 1, clearTimer: (h: unknown) => void (pending[h as number] = { fn: () => undefined, ms: 0 }) };
};

const text = (value: string): AnswerValue => ({ kind: 'text', value });
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('PL-12 · очередь отправки прохождения', () => {
  it('PL-12 · до начала прохождения на сервере всё ждёт; потом уходит по порядку', async () => {
    const t = transport();
    const c = new PlayClient({ transport: t, storage: memory(), instantFeedback: false });
    c.answer('vopros_1', text('а'), 100);
    c.state({ screenId: 'ekran_1' });
    await settle();
    expect(t.calls).toHaveLength(0);
    c.attach('sessiya1234567890');
    await settle();
    expect(t.calls.map((x) => `${x.method} ${x.path}`)).toEqual(['POST /play/sessions/sessiya1234567890/answers', 'PUT /play/sessions/sessiya1234567890/state']);
    expect(c.pending).toBe(0);
  });

  it('PL-12 · обрыв сети: операция остаётся, повторяется с тем же номером события; после успеха очередь пуста', async () => {
    const t = transport(['network', 'network', 'ok']);
    const tm = timers();
    const storage = memory();
    const c = new PlayClient({ transport: t, storage, instantFeedback: false, retryDelays: [10, 20], setTimer: tm.setTimer, clearTimer: tm.clearTimer });
    c.attach('sessiya1234567890');
    c.answer('vopros_1', text('а'), 100);
    await settle();
    expect(c.pending).toBe(1);
    expect(JSON.parse(storage.value!)).toHaveLength(1);
    expect(tm.pending.at(-1)!.ms).toBe(10);
    tm.pending.at(-1)!.fn();
    await settle();
    expect(tm.pending.at(-1)!.ms).toBe(20);
    tm.pending.at(-1)!.fn();
    await settle();
    expect(c.pending).toBe(0);
    expect(JSON.parse(storage.value!)).toEqual([]);
    const ids = t.calls.map((x) => (x.body as { clientEventId: string }).clientEventId);
    expect(new Set(ids).size).toBe(1);
    expect(t.calls).toHaveLength(3);
  });

  it('PL-11, PL-12 · очередь переживает перезагрузку: новая вкладка отправляет то, что осталось', async () => {
    const storage = memory();
    const offline = transport(['network']);
    const first = new PlayClient({ transport: offline, storage, instantFeedback: false, setTimer: () => 0, clearTimer: () => undefined });
    first.attach('sessiya1234567890');
    first.answer('vopros_1', text('а'), 5);
    await settle();
    expect(first.pending).toBe(1);
    const online = transport();
    const second = new PlayClient({ transport: online, storage, instantFeedback: false });
    second.attach('sessiya1234567890');
    await settle();
    expect(online.calls).toHaveLength(1);
    expect((online.calls[0]!.body as { blockId: string }).blockId).toBe('vopros_1');
    expect(second.pending).toBe(0);
  });

  it('PL-13 · отказ сервера (ошибка запроса) не повторяется: операция снимается, человеку — сообщение, остальное идёт дальше', async () => {
    const t = transport([422, 'ok']);
    const rejected: string[] = [];
    const c = new PlayClient({ transport: t, storage: memory(), instantFeedback: false, onRejected: (m) => rejected.push(m) });
    c.attach('sessiya1234567890');
    c.answer('vopros_1', text('плохой'), 1);
    c.answer('vopros_2', text('хороший'), 1);
    await settle();
    expect(rejected).toEqual(['Ошибка']);
    expect(t.calls).toHaveLength(2);
    expect(c.pending).toBe(0);
  });

  it('PL-12 · состояние: в очереди остаётся только последнее', async () => {
    const t = transport(['network']);
    const c = new PlayClient({ transport: t, storage: memory(), instantFeedback: false, setTimer: () => 0, clearTimer: () => undefined });
    c.attach('sessiya1234567890');
    c.state({ screenId: 'a' });
    await settle();
    c.state({ screenId: 'b' });
    c.state({ screenId: 'c' });
    expect(c.pending).toBe(1);
  });

  it('L-03 · «сразу»: после ответа спрашивается вердикт и отдаётся плееру', async () => {
    const t = transport();
    const verdicts: Array<[string, unknown]> = [];
    const c = new PlayClient({ transport: t, storage: memory(), instantFeedback: true, onVerdict: (b, v) => verdicts.push([b, v]) });
    c.attach('sessiya1234567890');
    c.answer('vopros_1', text('а'), 1);
    await settle();
    expect(t.calls.map((x) => x.path.split('/').at(-1))).toEqual(['answers', 'check']);
    expect(verdicts).toEqual([['vopros_1', { correct: true, score: 3 }]]);
  });

  it('PL-15 · конец: обещание выполняется ответом сервера, даже если сеть вернулась позже', async () => {
    const t = transport(['network', 'ok']);
    const tm = timers();
    const c = new PlayClient({ transport: t, storage: memory(), instantFeedback: false, retryDelays: [5], setTimer: tm.setTimer, clearTimer: tm.clearTimer });
    c.attach('sessiya1234567890');
    const done = c.complete();
    await settle();
    expect(c.pending).toBe(1);
    tm.pending.at(-1)!.fn();
    expect(await done).toEqual({ totals: { score: 3, max: 5, correct: 1, keyed: 2 }, result: { key: 'Итог', screenId: 'ekran_itog' } });
  });
});
