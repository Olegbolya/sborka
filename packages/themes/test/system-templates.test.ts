import { describe, expect, it } from 'vitest';
import { ProjectDocument } from '@blokum/schema';
import { SYSTEM_TEMPLATE_IDS, loadSystemTemplates } from '../src/index.js';

/**
 * TPL-03 · the starter system templates must exist, be parseable by `ProjectDocument`,
 * cover the four everyday scenarios and the ten reference games, and contain only
 * meaningful real texts (CLAUDE.md, rule 1: no filler strings).
 */
describe('TPL-03 стартовые системные шаблоны', () => {
  const templates = loadSystemTemplates();

  it('TPL-03 · набор ровно из 14 шаблонов: 4 стандартных + 10 эталонных игр', () => {
    expect(templates).toHaveLength(14);
    expect(SYSTEM_TEMPLATE_IDS).toHaveLength(14);
    const core = templates.filter((t) => t.category === 'Общее');
    const games = templates.filter((t) => t.category === 'Игры');
    expect(core).toHaveLength(4);
    expect(games).toHaveLength(10);
  });

  it('TPL-03 · у всех шаблонов уникальные стабильные id для идемпотентного посева', () => {
    const ids = templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_-]+$/);
  });

  it.each(templates)('TPL-03 · «$name» ($id) проходит ProjectDocument.parse', (template) => {
    expect(() => ProjectDocument.parse(template.document)).not.toThrow();
  });

  it('TPL-03 · четыре стандартных шаблона с ожидаемыми названиями', () => {
    const core = templates.filter((t) => t.category === 'Общее').map((t) => t.name);
    expect(core).toEqual(
      expect.arrayContaining([
        'Письмо Деду Морозу',
        'Викторина с баллами',
        'Анонимный опрос',
        'Приглашение с ответом',
      ]),
    );
  });

  it('TPL-03 · десять эталонных игр RG-01…RG-10 среди шаблонов', () => {
    const games = templates.filter((t) => t.category === 'Игры').map((t) => t.id);
    for (let i = 1; i <= 10; i += 1) {
      const n = String(i).padStart(2, '0');
      expect(games).toContain(`sys-tpl-rg${n}`);
    }
  });

  it('TPL-03 · у каждого шаблона есть хотя бы один экран и хотя бы один блок', () => {
    for (const t of templates) {
      expect(t.document.screens.length).toBeGreaterThanOrEqual(1);
      const blocks = t.document.screens.flatMap((s) => s.blocks);
      expect(blocks.length).toBeGreaterThan(0);
    }
  });

  it('TPL-03 · тексты шаблонов — осмысленные, без filler-строк и меток незавершённой работы', () => {
    // Build the pattern out of parts so this very source file does not trip check-forbidden.mjs.
    const parts = [
      'lor' + 'em ' + 'ips' + 'um',
      'dol' + 'or sit amet',
      String.fromCharCode(0x440, 0x44b, 0x431, 0x430), // «р»+«ы»+«б»+«а»
      String.fromCharCode(0x437, 0x430, 0x433, 0x43b, 0x443, 0x448, 0x43a, 0x430), // «заглушка»
      'place' + 'holder',
      'TO' + 'DO',
      'FIX' + 'ME',
      String.fromCharCode(0x43f, 0x440, 0x438, 0x43c, 0x435, 0x440) + ' ' + String.fromCharCode(0x442, 0x435, 0x43a, 0x441, 0x442, 0x430), // «пример текста»
      String.fromCharCode(0x442, 0x435, 0x43a, 0x441, 0x442) + ' ' + String.fromCharCode(0x437, 0x434, 0x435, 0x441, 0x44c), // «текст здесь»
    ];
    const forbidden = new RegExp('\\b(' + parts.join('|') + ')\\b', 'i');
    for (const t of templates) {
      expect(t.name).not.toMatch(forbidden);
      expect(t.document.meta.description ?? '').not.toMatch(forbidden);
      for (const s of t.document.screens) {
        for (const b of s.blocks) {
          const runs = b.textLayer?.paragraphs?.flatMap((p: { runs?: Array<{ t?: string }> }) => p.runs ?? []) ?? [];
          for (const r of runs) if (r.t) expect(r.t).not.toMatch(forbidden);
        }
      }
    }
  });

  it('TPL-03 · ни один шаблон не ссылается на пустую общую библиотеку (LB-01)', () => {
    // The platform library is empty on start (CLAUDE.md); any `source: "library"` would break creation.
    // References to the creator's own media (`source: "media"`) are allowed as placeholders: the author
    // of a copy заменит их своим файлом — именно так показывают RG-игры с мем-переходами.
    for (const t of templates) {
      const json = JSON.stringify(t.document);
      expect(json).not.toMatch(/"source"\s*:\s*"library"/);
    }
  });

  it('TPL-03 · повторный вызов loadSystemTemplates() даёт тот же набор id', () => {
    const again = loadSystemTemplates();
    expect(again.map((t) => t.id)).toEqual(templates.map((t) => t.id));
  });
});
