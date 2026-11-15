import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { legalDir, readLegalFile } from '../lib/legal-files';

describe('P8.1 · тексты документов находятся и из apps/web, и из корня репозитория', () => {
  it('P8.1 · из apps/web берётся папка legal/ в корне репозитория', () => {
    const web = resolve(__dirname, '..');
    expect(legalDir(web)).toBe(resolve(web, '..', '..', 'legal'));
    expect(readLegalFile('contacts.md', web)).toContain('Контакты и реквизиты');
    expect(readLegalFile('offer.md', web).length).toBeGreaterThan(200);
  });
  it('P8.1 · папка рядом с точкой запуска главнее; нет папки или файла — пустая строка', () => {
    const root = mkdtempSync(join(tmpdir(), 'legal-'));
    expect(legalDir(root)).toBeNull();
    expect(readLegalFile('contacts.md', root)).toBe('');
    mkdirSync(join(root, 'legal'));
    writeFileSync(join(root, 'legal', 'contacts.md'), 'Свой текст');
    expect(readLegalFile('contacts.md', root)).toBe('Свой текст');
    expect(readLegalFile('нет.md', root)).toBe('');
  });
});
