import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Папка `legal/` с текстами документов лежит в корне репозитория, а сайт запускается из `apps/web`
 * (так его стартует PM2 на сервере и `next start` в тестах): ищем и рядом, и двумя уровнями выше.
 */
export function legalDir(cwd: string = process.cwd()): string | null {
  for (const dir of [resolve(cwd, 'legal'), resolve(cwd, '..', '..', 'legal')]) if (existsSync(dir)) return dir;
  return null;
}

/** Текст документа из `legal/<file>`; пустая строка, только если папки или файла правда нет. */
export function readLegalFile(file: string, cwd?: string): string {
  const dir = legalDir(cwd);
  if (!dir) return '';
  const path = resolve(dir, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}
