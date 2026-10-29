import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.(ts|tsx|css)$/.test(n) ? [join(dir, n)] : []));
const games = Array.from({ length: 10 }, (_, i) => `rg-${String(i + 1).padStart(2, '0')}`).map((id) => ({ id, title: (JSON.parse(readFileSync(join(root, 'themes/examples', `${id}.json`), 'utf8')) as { meta: { title: string } }).meta.title }));

describe('RG-01 RG-02 RG-03 RG-04 RG-05 RG-06 RG-07 RG-08 RG-09 RG-10 · в движке и рендерере нет кода под конкретную игру', () => {
  const sources = [...files(join(root, 'engine/src')), ...files(join(root, 'renderer/src'))].map((f) => ({ f, text: readFileSync(f, 'utf8') }));

  it('нашлись исходники обоих пакетов и все десять документов-игр', () => {
    expect(sources.length).toBeGreaterThan(20);
    expect(games).toHaveLength(10);
  });

  it.each(games)('игра $id: ни названия, ни идентификатора, ни номера эталона в исходниках', ({ id, title }) => {
    const n = id.slice(3);
    const found = sources.filter(({ text }) => text.includes(title) || text.includes(`rg${n}_`) || text.includes(`RG-${n}`) || text.includes(id)).map(({ f }) => f);
    expect(found).toEqual([]);
  });
});
