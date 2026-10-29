import { createBlock } from '@blokum/schema';
import { describe, expect, it } from 'vitest';
import { clearClipboard, readClipboard, writeClipboard } from '../lib/editor/clipboard';

describe('ASVS V8.2.3 · буфер редактора после выхода', () => {
  it('V8.2.3: скопированное в редакторе стирается при выходе из аккаунта', () => {
    writeClipboard({ kind: 'blokum-blocks', version: 1, blocks: [createBlock('text')] });
    expect(readClipboard()).not.toBeNull();
    clearClipboard();
    expect(readClipboard()).toBeNull();
  });
});
