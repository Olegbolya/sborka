import { type Alert, Alerts } from '@blokum/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDiskWatch } from '../src/monitoring.js';

const statfsAt = (pct: () => number) => () =>
  Promise.resolve({ blocks: 1000, bfree: 1000 - pct() * 10, bavail: 1000 - pct() * 10, bsize: 4096 });

describe('контроль диска в воркере', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('проверяет сразу и по расписанию; тревога при заполнении выше 80 %', async () => {
    vi.useFakeTimers();
    let pct = 50;
    const sent: Alert[] = [];
    const alerts = new Alerts({ channels: [{ name: 't', send: (a) => (sent.push(a), Promise.resolve()) }] });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const watch = startDiskWatch({ paths: ['/srv/blokum'], alerts, logger, intervalMs: 600_000, statfs: statfsAt(() => pct) });
    await vi.advanceTimersByTimeAsync(0);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);
    pct = 86;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.title).toBe('Диск заполнен на 86 %');
    watch.stop();
  });

  it('ошибка чтения диска логируется и не роняет воркер', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const watch = startDiskWatch({
      paths: ['/x'],
      alerts: new Alerts({ channels: [] }),
      logger,
      intervalMs: 600_000,
      statfs: () => Promise.reject(new Error('нет раздела')),
    });
    await watch.check();
    expect(logger.warn).toHaveBeenCalled();
    watch.stop();
  });
});
