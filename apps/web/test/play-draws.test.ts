import { describe, expect, it } from 'vitest';
import { ServerDraws } from '../lib/play/draws';
import { type PlayTransport } from '../lib/play/play-client';

const settle = () => new Promise((r) => setTimeout(r, 0));

function transport(fail = false): PlayTransport & { calls: Array<{ path: string; body: { sourceId: string; seq: number } }> } {
  const calls: Array<{ path: string; body: { sourceId: string; seq: number } }> = [];
  return {
    calls,
    call<T>(_m: 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
      const b = body as { sourceId: string; seq: number };
      calls.push({ path, body: b });
      if (fail) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({ outcome: b.sourceId === 'main' ? { value: 0.25 } : { index: b.seq + 2 } } as T);
    },
  };
}

describe('RN-01 · ServerDraws', () => {
  it('RN-01 · тянет исходы вперёд по порядку и выдаёт сектор, названный сервером', async () => {
    const t = transport();
    const onDevice: number[] = [];
    const draws = new ServerDraws(t, { default: 1 }, () => onDevice.push(1));
    draws.watch('koleso');
    draws.attach('sess_1');
    await settle();
    expect(draws.drawWheel('koleso')).toBe(2);
    await settle();
    expect(draws.drawWheel('koleso')).toBe(3);
    expect(t.calls.map((c) => c.body.seq)).toEqual([0, 1, 2]);
    expect(onDevice).toEqual([]);
  });

  it('RN-01 · без ответа сервера крутит своё и сообщает «на устройстве»', async () => {
    const onDevice: number[] = [];
    const draws = new ServerDraws(transport(true), { default: 1 }, () => onDevice.push(1));
    draws.watch('main');
    draws.attach('sess_1');
    await settle();
    const v = draws.next();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
    expect(draws.drawWheel('koleso')).toBeUndefined();
    expect(onDevice.length).toBe(2);
  });

  it('RN-01 · общий поток берёт число с сервера', async () => {
    const draws = new ServerDraws(transport(), { main: 2, default: 1 }, () => undefined);
    draws.watch('main');
    draws.attach('sess_1');
    await settle();
    expect(draws.next()).toBe(0.25);
  });
});
