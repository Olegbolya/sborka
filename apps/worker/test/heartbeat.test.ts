import RedisMock from 'ioredis-mock';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadWorkerConfig } from '../src/config.js';
import { HEARTBEAT_KEY, startHeartbeat } from '../src/heartbeat.js';

describe('heartbeat воркера', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('пишет ключ с префиксом bk: и TTL в три интервала', async () => {
    const redis = new RedisMock();
    const hb = startHeartbeat(redis, { keyPrefix: 'bk:', intervalMs: 1000, now: () => new Date('2026-10-20T10:00:00Z') });
    await hb.beat();
    expect(await redis.get(`bk:${HEARTBEAT_KEY}`)).toBe('2026-10-20T10:00:00.000Z');
    const ttl = await redis.pttl(`bk:${HEARTBEAT_KEY}`);
    expect(ttl).toBeGreaterThan(2000);
    expect(ttl).toBeLessThanOrEqual(3000);
    await hb.stop();
  });

  it('обновляет ключ по таймеру', async () => {
    vi.useFakeTimers();
    const redis = new RedisMock();
    let t = Date.parse('2026-10-20T10:00:00Z');
    const hb = startHeartbeat(redis, { keyPrefix: 'bk:', intervalMs: 1000, now: () => new Date(t) });
    t += 5000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(await redis.get(`bk:${HEARTBEAT_KEY}`)).toBe('2026-10-20T10:00:05.000Z');
    await hb.stop();
  });

  it('stop() удаляет ключ', async () => {
    const redis = new RedisMock();
    const hb = startHeartbeat(redis, { keyPrefix: 'bk:', intervalMs: 1000 });
    await hb.beat();
    await hb.stop();
    expect(await redis.get(`bk:${HEARTBEAT_KEY}`)).toBeNull();
  });

  it('ошибка Redis передаётся в onError и не роняет процесс', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const failing = { set: () => Promise.reject(new Error('нет связи')), del: () => Promise.resolve(0) };
    const hb = startHeartbeat(failing, { keyPrefix: 'bk:', intervalMs: 1000, onError });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledOnce();
    await hb.stop();
  });
});

describe('настройки воркера', () => {
  it('по умолчанию Redis БД 3 на 127.0.0.1 и префикс bk:', () => {
    expect(loadWorkerConfig({})).toEqual({ redisUrl: 'redis://127.0.0.1:6379/3', keyPrefix: 'bk:', heartbeatIntervalMs: 10_000 });
  });

  it('отклоняет неверный адрес и слишком частый heartbeat', () => {
    expect(() => loadWorkerConfig({ REDIS_URL: 'http://x' })).toThrow('REDIS_URL');
    expect(() => loadWorkerConfig({ WORKER_HEARTBEAT_MS: '10' })).toThrow('WORKER_HEARTBEAT_MS');
  });
});
