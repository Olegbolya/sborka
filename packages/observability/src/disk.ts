import { statfs as statfsAsync } from 'node:fs/promises';
import { type Alerts } from './alerts.js';

export interface FsStats {
  blocks: number;
  bfree: number;
  bavail: number;
  bsize: number;
}
export type StatFs = (path: string) => Promise<FsStats>;

/** Used space in percent, computed like `df` (reserved blocks count as unavailable). */
export async function diskUsagePercent(path: string, statfs: StatFs = statfsAsync): Promise<number> {
  const s = await statfs(path);
  const used = s.blocks - s.bfree;
  const total = used + s.bavail;
  return total === 0 ? 0 : Math.round((used / total) * 1000) / 10;
}

/** Raises an alert for every path whose usage exceeds the threshold (default 80 %, docs/02-ARCHITECTURE.md §9). */
export async function checkDisks(
  paths: string[],
  alerts: Alerts,
  options: { thresholdPct?: number; statfs?: StatFs } = {},
): Promise<Array<{ path: string; usedPct: number; alerted: boolean }>> {
  const threshold = options.thresholdPct ?? 80;
  const results = [];
  for (const path of paths) {
    const usedPct = await diskUsagePercent(path, options.statfs);
    let alerted = false;
    if (usedPct > threshold) {
      alerted = await alerts.raise(
        `disk:${path}`,
        `Диск заполнен на ${usedPct} %`,
        `Раздел ${path}: занято ${usedPct} % (порог ${threshold} %). Освободите место: старые релизы, временные файлы, экспорт.`,
        usedPct > 95 ? 'critical' : 'warning',
      );
    }
    results.push({ path, usedPct, alerted });
  }
  return results;
}
