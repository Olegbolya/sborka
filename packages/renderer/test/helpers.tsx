import { type Block, type BlockInput, ProjectDocument, type Screen, type ThemeTokens, createBlock } from '@blokum/schema';
import { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Artboard, type ArtboardProps, DEV_THEMES, type MediaResolver } from '../src/index.js';

export const media: MediaResolver = (ref) => (ref.id.startsWith('video') ? { url: `https://media.blokum.ru/${ref.id}.mp4`, kind: 'video' } : { url: `https://media.blokum.ru/${ref.id}.webp`, kind: 'image' });

/** Renders inside an artboard and returns a detached DOM element for queries. */
export function render(node: ReactNode, props: Partial<ArtboardProps> = {}): HTMLElement {
  const html = renderToStaticMarkup(
    <Artboard mode="editor" tokens={DEV_THEMES.light} media={media} unit={1} {...props}>
      {node}
    </Artboard>,
  );
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

export const block = (type: BlockInput['type'], extra: Partial<BlockInput> = {}): Block => createBlock(type, { id: `blok-${type}`.slice(0, 20).padEnd(6, '0'), ...extra });

export function screenOf(blocks: Block[], extra: Partial<Screen> = {}): Screen {
  return ProjectDocument.parse({ schemaVersion: 1, screens: [{ id: 'ekran1', name: 'Экран', blocks, ...extra }] }).screens[0]!;
}

export const styleOf = (el: Element | null | undefined): string => (el as HTMLElement | null)?.getAttribute('style') ?? '';
export const themes: Record<'light' | 'dark', ThemeTokens> = DEV_THEMES;
