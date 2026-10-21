'use client';

import { type Block, type RichText, type ThemeTokens } from '@blokum/schema';
import { type AnswerValue, type BlockView as RuntimeView, type RuntimeEvent, type VariableValue } from '@blokum/engine';
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
  /** Lets a block move its element itself when only its place changes (see `RuntimeStore.registerPosition`). */
  registerPosition?: (instanceId: string, sink: (x: number, y: number) => void) => () => void;
  /** Sounds of the player (unlocked by the first gesture). */
  sound?: SoundManager;
  /** Answers of the passage (from the runtime): chosen options, typed text, scale values (B-11…B-20). */
  answers?: Readonly<Record<string, AnswerValue>>;
  /** Variables of the passage (B-09 «значение переменной», B-23). */
  variables?: Readonly<Record<string, VariableValue>>;
  /** Place of the screen in the passage for «экран N из M» (B-09). */
  progress?: { index: number; total: number };
  /** Seconds left on a timer block (B-08), from the runtime. */
  timerRemaining?: (blockId: string) => number | undefined;
  /** Text of the consent to personal data processing (B-20), generated from the creator's details (PL-23). */
  consentUrl?: string;
  /** Questions on the screen still blocking «дальше» (L-07) — a button with «требует ответов» waits for them. */
  requiredMissing?: boolean;
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
