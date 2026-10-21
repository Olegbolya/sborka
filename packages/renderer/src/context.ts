'use client';

import { type Block, type RichText, type ThemeTokens } from '@blokum/schema';
import { type BlockView as RuntimeView, type RuntimeEvent } from '@blokum/engine';
import { type ReactNode, createContext, useContext } from 'react';
import { type BlockCss, type MediaResolver } from './style/style-to-css.js';
import { type SoundManager } from './sound/sound-manager.js';
import { DEV_THEMES } from './theme/dev-themes.js';

/** Where blocks are drawn: the editor canvas, the participant's player or a static thumbnail. */
export type RenderMode = 'editor' | 'player' | 'thumbnail';

export type TextRunValue = (run: RichText['paragraphs'][number]['runs'][number]) => string | null;

export interface RenderContextValue {
  mode: RenderMode;
  tokens: ThemeTokens;
  media: MediaResolver;
  /** Text of a placeholder run (variables, answers, «баллы»…); null keeps the placeholder visible (editor). */
  runText: TextRunValue;
  /** Address a text link opens through (PL-22 safe redirect in the player). */
  linkHref: (url: string) => string;
  /** Live state from the scenario runtime (player and preview). */
  views?: ReadonlyMap<string, RuntimeView>;
  dispatch?: (event: RuntimeEvent) => void;
  /** Sounds of the player (unlocked by the first gesture). */
  sound?: SoundManager;
  /** Type-specific content of a block (media, questions…), drawn under its text layer. */
  renderContent?: (block: Block, css: BlockCss, instanceId: string) => ReactNode;
}

const placeholder: TextRunValue = (run) => {
  if ('sys' in run) return `{{${run.sys}}}`;
  if ('v' in run) return '{{переменная}}';
  if ('answer' in run) return '{{ответ}}';
  return null;
};

export const defaultRenderContext: RenderContextValue = {
  mode: 'editor',
  tokens: DEV_THEMES.light,
  media: () => null,
  runText: placeholder,
  linkHref: (url) => url,
};

export const RenderContext = createContext<RenderContextValue>(defaultRenderContext);
export const useRenderContext = (): RenderContextValue => useContext(RenderContext);
