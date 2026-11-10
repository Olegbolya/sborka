import { createBlock, createDocument } from '@blokum/schema';
import { describe, expect, it } from 'vitest';
import { clearClipboard, copyScreen, pasteScreen, readScreenClipboard, writeScreenClipboard } from '../lib/editor/clipboard';

describe('E-08 · копирование экрана вместе с содержимым в другую сборку', () => {
  it('E-08: экран с блоками переносится в другой документ с новыми идентификаторами и стирается при выходе', () => {
    const from = createDocument();
    const text = createBlock('text');
    from.screens[0]!.blocks.push(text);
    const payload = copyScreen(from, from.screens[0]!.id)!;
    writeScreenClipboard(payload);

    const to = createDocument();
    const read = readScreenClipboard()!;
    pasteScreen(read, to.screens[0]!.id)(to);

    expect(to.screens).toHaveLength(2);
    const pasted = to.screens[1]!;
    expect(pasted.blocks).toHaveLength(1);
    expect(pasted.blocks[0]!.id).not.toBe(text.id);
    expect(pasted.id).not.toBe(from.screens[0]!.id);

    clearClipboard();
    expect(readScreenClipboard()).toBeNull();
  });
});
