import { describe, expect, it } from 'vitest';
import { BLOCK_PROPS, ProjectDocument, createDocument, type BlockType } from '@blokum/schema';
import { addBlock, setBlockProps } from '../lib/editor/commands';
import { CATALOG, propKeys } from '../lib/editor/props-specs';
import { createEditorStore } from '../lib/editor/store';
import { findBlock } from '../lib/editor/tree';

/** B-01…B-23: какой вид блока стоит за каждым номером требования (docs/01-PRODUCT-SPEC.md, §«Блоки»). */
const KINDS: Array<[string, BlockType, string]> = [
  ['B-02', 'image', 'Изображение'],
  ['B-03', 'gif', 'GIF'],
  ['B-04', 'video', 'Видео'],
  ['B-05', 'audio', 'Аудио'],
  ['B-06', 'shape', 'Фигура'],
  ['B-07', 'animation', 'Анимация / стикер'],
  ['B-08', 'timer', 'Таймер'],
  ['B-09', 'progress', 'Прогресс'],
  ['B-11', 'singleChoice', 'Выбор одного варианта'],
  ['B-12', 'multiChoice', 'Выбор нескольких'],
  ['B-13', 'textInput', 'Текстовый ответ'],
  ['B-14', 'scale', 'Шкала / рейтинг'],
  ['B-15', 'swipe', 'Свайп-карточка'],
  ['B-16', 'ranking', 'Ранжирование'],
  ['B-17', 'date', 'Дата / время'],
  ['B-18', 'button', 'Кнопка'],
  ['B-19', 'contacts', 'Контактные данные'],
  ['B-20', 'consent', 'Согласие на обработку ПД'],
  ['B-21', 'container', 'Контейнер'],
  ['B-22', 'zone', 'Зона'],
];

describe('P3.5 · каждый вид блока добавляется из каталога и правится через таблицу свойств', () => {
  for (const [id, type, name] of KINDS) {
    it(`${id} · «${name}»: есть в каталоге, добавляется на экран, документ проходит схему, свойства правятся только в границах схемы`, () => {
      // «Согласие» — системный блок (B-20): его не добавляют из каталога, он приходит вместе с «Контактными данными» (B-19).
      expect(CATALOG.some((e) => e.type === type), 'каталог').toBe(type !== 'consent');
      const doc = createDocument();
      const store = createEditorStore(doc);
      let ids: string[] = [];
      store.getState().apply(addBlock(doc.screens[0]!.id, type === 'consent' ? 'contacts' : type, null, (c) => (ids = c)), { label: id });
      const at = (bid: string) => findBlock(store.getState().doc, bid)!;
      const block = at(ids[type === 'consent' ? 1 : 0]!).siblings[at(ids[type === 'consent' ? 1 : 0]!).index]!;
      expect(block.type).toBe(type);
      expect(ProjectDocument.safeParse(store.getState().doc).success).toBe(true);
      expect(BLOCK_PROPS[type].safeParse(block.props).success).toBe(true);
      // У фигуры и контейнера своих свойств нет: вид задают стиль (S-02) и раскладка (S-20).
      if (Object.keys(BLOCK_PROPS[type].shape).length > 0) expect(propKeys(type).length).toBeGreaterThan(0);

      // Допустимая правка применяется (то же значение), посторонний ключ схема не пропускает — свойства не меняются.
      const before = JSON.stringify(block.props);
      store.getState().apply(setBlockProps([block.id], (p) => ({ ...p, nepravilnoe_pole: 1 })), { label: id });
      const after = findBlock(store.getState().doc, block.id)!;
      expect(JSON.stringify(after.siblings[after.index]!.props)).toBe(before);
      store.getState().apply(setBlockProps([block.id], (p) => p), { label: id });
      expect(ProjectDocument.safeParse(store.getState().doc).success).toBe(true);
    });
  }
});
