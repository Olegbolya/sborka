import { type Alerts, type Logger, type StatFs, checkDisks } from '@blokum/observability';

/**
 * Periodic free-space check of the data and system partitions (alert above 80 %, docs/02-ARCHITECTURE.md §9).
 * Runs once immediately, then every `intervalMs`. Errors are logged, never thrown.
 */
export function startDiskWatch(opts: {
  paths: string[];
  alerts: Alerts;
  logger: Pick<Logger, 'info' | 'warn'>;
  intervalMs: number;
  statfs?: StatFs;
}): { check(): Promise<void>; stop(): void } {
  const check = async (): Promise<void> => {
    try {
      const results = await checkDisks(opts.paths, opts.alerts, { statfs: opts.statfs });
      opts.logger.info({ disks: results }, 'проверка диска');
    } catch (e) {
      opts.logger.warn({ err: e }, 'Не удалось проверить место на диске');
    }
  };
  const timer = setInterval(() => void check(), opts.intervalMs);
  timer.unref();
  void check();
  return { check, stop: () => clearInterval(timer) };
}
