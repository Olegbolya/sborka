import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LegalMarkdown, parseLegal } from '../components/legal/LegalMarkdown';
import { readLegalFile } from '../lib/legal-files';
import { resolve } from 'node:path';

describe('P8.1 · документы показываются оформленными, а не разметкой', () => {
  it('P8.1 · заголовки, списки, таблица, цитата и ссылки разбираются; первый заголовок пропущен', () => {
    const md = '# Название\n\nВступ **важно** см. /legal/offer и `код`.\n\n## Раздел\n\n- один\n- два\n  продолжение\n\n1. первый\n2. второй\n\n> Примечание\n\n| A | B |\n|---|---|\n| 1 | 2 |\n';
    const blocks = parseLegal(md);
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'h', 'ul', 'ol', 'quote', 'table']);
    expect(blocks[2]).toEqual({ kind: 'ul', items: ['один', 'два продолжение'] });
    expect(blocks[5]).toEqual({ kind: 'table', head: ['A', 'B'], rows: [['1', '2']] });
    const html = renderToStaticMarkup(<LegalMarkdown source={md} />);
    expect(html).not.toContain('Название');
    expect(html).toContain('<strong>важно</strong>');
    expect(html).toContain('<a href="/legal/offer">/legal/offer</a>');
    expect(html).toContain('<h2>Раздел</h2>');
    expect(html).not.toMatch(/##|\*\*|\|---/);
  });

  it('P8.1 · опубликованные документы не содержат черновых пометок и незаполненных подстановок, у каждого есть дата редакции', () => {
    const web = resolve(__dirname, '..');
    for (const f of ['terms.md', 'offer.md', 'privacy.md', 'pd-consent.md', 'dpa.md', 'content-rules.md', 'cookies.md', 'marketing.md', 'complaints.md', 'contacts.md']) {
      const text = readLegalFile(f, web);
      expect(text, f).toMatch(/Редакция от \d{1,2} (января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря) \d{4} г\./);
      expect(text, f).not.toMatch(/ЧЕРНОВИК|не установлена|\{\{/);
      const html = renderToStaticMarkup(<LegalMarkdown source={text} />);
      expect(html, f).not.toMatch(/(^|>)\s*#|\*\*/);
    }
  });
});
