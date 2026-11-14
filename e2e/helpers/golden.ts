import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { PHOTO_PNG, SMALL_PNG, TINY_GIF, wav } from './files';
import { seedProject, type SeedProject } from './editor';

/*
 * P5.7 · документы эталонных сборок GS-01 и GS-02 (e2e/fixtures/*.json) — это то, что сквозные тесты собрали в редакторе
 * (`GOLDEN_DUMP=папка pnpm e2e e2e/golden-*.spec.ts` сохраняет их заново). Для замеров они кладутся в чистую учётную запись:
 * каждый файл, на который они ссылаются, загружается заново файлом того же вида, а ссылки заменяются новыми номерами.
 */
export type Golden = 'gs01' | 'gs02';

type Json = Record<string, unknown> | unknown[];

function fileFor(pathOfRef: string): { name: string; mimeType: string; buffer: Buffer } {
  if (pathOfRef.includes('/do/')) return { name: 'zvuk.wav', mimeType: 'audio/wav', buffer: wav() };
  if (pathOfRef.includes('transitionIn') || pathOfRef.includes('mediaByAnswer') || pathOfRef.includes('/fills/')) return { name: 'meme.gif', mimeType: 'image/gif', buffer: TINY_GIF };
  if (pathOfRef.includes('background')) return { name: 'fon.png', mimeType: 'image/png', buffer: PHOTO_PNG };
  return { name: 'kartinka.png', mimeType: 'image/png', buffer: SMALL_PNG };
}

/** Сборка в учётной записи, под которой выполнен вход: содержимое — документ эталона, файлы — свои. */
export async function seedGolden(page: Page, which: Golden): Promise<SeedProject> {
  const origin = new URL(page.url()).origin;
  const source = JSON.parse(readFileSync(path.resolve(process.cwd(), `e2e/fixtures/${which}.json`), 'utf8')) as Record<string, unknown>;
  const uploaded = new Map<string, string>();
  const refs: Array<{ holder: Record<string, unknown>; at: string }> = [];
  const walk = (v: unknown, at: string): void => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}/${i}`));
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.source === 'media' && typeof o.id === 'string') refs.push({ holder: o, at });
      else Object.entries(o).forEach(([k, x]) => walk(x, `${at}/${k}`));
    }
  };
  walk(source, '');
  for (const { holder, at } of refs) {
    const old = holder.id as string;
    if (!uploaded.has(old)) {
      const res = await page.request.post('/api/v1/media', { headers: { origin }, multipart: { file: fileFor(at) } });
      if (!res.ok()) throw new Error(`Не загрузился файл для ${which}: ${res.status()}`);
      uploaded.set(old, ((await res.json()) as { id: string }).id);
    }
    holder.id = uploaded.get(old)!;
  }
  return seedProject(page, (d) => {
    const doc = d as unknown as Record<string, Json>;
    // Тема — только значения оформления: собственной темы автора эталона в этой учётной записи нет.
    const themeId = (doc.theme as { themeId?: string }).themeId;
    doc.theme = { ...(source.theme as object), ...(themeId ? { themeId } : {}) } as never;
    if (!themeId) delete (doc.theme as { themeId?: string }).themeId;
    for (const key of ['screens', 'rules', 'results', 'variables', 'settings', 'artboard'] as const) doc[key] = source[key] as never;
    (doc.meta as Record<string, unknown>).description = (source.meta as { description?: string }).description ?? '';
  }, (source.meta as { title: string }).title);
}
