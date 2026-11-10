import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'legal', 'internal');
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');

describe('P8.6 · внутренние документы оператора и черновик уведомления в РКН (05-LEGAL §6, §2.1)', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));

  it('P8.6 · в legal/internal лежат ровно 10 документов из перечня §6', () => {
    expect(files).toHaveLength(10);
    expect(files).toContain('rkn-notification-draft.md');
    for (const f of files) {
      const text = read(f);
      expect(text.length, f).toBeGreaterThan(1200);
      expect(text, f).toContain('Не публикуется');
    }
  });

  it('P8.6 · черновик уведомления покрывает все поля формы и помечает, что подставить владельцу', () => {
    const t = read('rkn-notification-draft.md');
    for (const field of ['Сведения об операторе', 'Цели обработки', 'Категории и перечень ПД', 'Категории субъектов', 'Перечень действий', 'Меры по обеспечению безопасности', 'Ответственный за организацию', 'Дата начала обработки', 'Срок или условие прекращения', 'Трансграничная передача', 'Место нахождения баз данных']) {
      expect(t, field).toContain(field);
    }
    expect(t).toContain('ПОДСТАВИТЬ');
    expect(t).toContain('ПРОВЕРИТЬ');
    expect(t).toContain('{{ИСПОЛНИТЕЛЬ_ФИО}}');
  });

  it('P8.6 · регламент инцидентов называет сроки 24 и 72 часа, а порядок уничтожения — журнал и приказ № 179', () => {
    const inc = read('06-reglament-reagirovaniya-na-incidenty.md');
    expect(inc).toContain('24 часов');
    expect(inc).toContain('72 часа');
    const del = read('09-poryadok-unichtozheniya-pd.md');
    expect(del).toContain('№ 179');
    expect(del).toContain('destruction_log');
    expect(read('07-reglament-zaprosov-subektov.md')).toContain('10 рабочих дней');
  });
});
