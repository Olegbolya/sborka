import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const run = (root?: string) => spawnSync('node', ['scripts/check-ui-language.mjs', ...(root ? [`--root=${root}`] : [])], { cwd: ROOT, encoding: 'utf8' });

describe('N-05 · весь интерфейс на русском: scripts/check-ui-language.mjs', () => {
  it('N-05 · в репозитории нет латиницы в текстах для людей, кроме согласованного списка', () => {
    const r = run();
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  }, 60_000);

  it('N-05 · английский текст на экране находится; слова из списка и помеченная строка проходят', () => {
    const root = mkdtempSync(join(tmpdir(), 'ui-language-'));
    const dir = join(root, 'apps', 'web', 'components');
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(dir, 'Ok.tsx'), "export const A = () => <p>Скачайте файл в формате CSV или PNG, код QR и email</p>;\nexport const B = () => (\n  // ui-language-ok: проверка\n  <p title=\"Save the file\">Текст</p>\n);\n");
      expect(run(root).status).toBe(0);
      writeFileSync(join(dir, 'Bad.tsx'), 'export const A = () => <button aria-label="Close window">Закрыть</button>;\nexport const B = () => <p>Click here to continue</p>;\n');
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('Bad.tsx:1');
      expect(r.stderr).toContain('Bad.tsx:2');
      expect(r.stderr).not.toContain('Ok.tsx');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it('N-05 · сообщения об ошибках API с латиницей находятся по полю message', () => {
    const root = mkdtempSync(join(tmpdir(), 'ui-language-'));
    const dir = join(root, 'apps', 'api', 'src');
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(dir, 'bad.ts'), "export const e = { error: { code: 'X', message: 'Invalid token supplied' } };\n");
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('bad.ts:1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
