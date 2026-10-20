/** Minimal Redis surface used by the heartbeat, so tests can pass an in-memory client. */
export interface HeartbeatRedis {
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export const HEARTBEAT_KEY = 'worker:heartbeat';

export interface Heartbeat {
  /** Writes one heartbeat immediately; resolves when Redis acknowledged it. */
  beat(): Promise<void>;
  /** Stops the timer and removes the key so monitoring sees the worker as stopped. */
  stop(): Promise<void>;
}

/**
 * Periodically writes `{prefix}worker:heartbeat` = ISO time with a TTL of three intervals.
 * The health page (AD-09) treats a missing key as «worker is not running».
 */
export function startHeartbeat(
  redis: HeartbeatRedis,
  opts: { keyPrefix: string; intervalMs: number; now?: () => Date; onError?: (e: unknown) => void },
): Heartbeat {
  const key = `${opts.keyPrefix}${HEARTBEAT_KEY}`;
  const now = opts.now ?? (() => new Date());
  const beat = async (): Promise<void> => {
    await redis.set(key, now().toISOString(), 'PX', opts.intervalMs * 3);
  };
  const timer = setInterval(() => {
    beat().catch((e: unknown) => opts.onError?.(e));
  }, opts.intervalMs);
  timer.unref();
  return {
    beat,
    async stop() {
      clearInterval(timer);
      await redis.del(key);
    },
  };
}
