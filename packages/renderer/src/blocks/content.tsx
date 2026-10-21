import { type Block } from '@blokum/schema';
import { type ReactNode } from 'react';
import { type BlockCss } from '../style/style-to-css.js';
import { ProgressContent, TimerContent, ValueContent, ZoneContent } from './display.js';
import { AnimationContent, AudioContent, ImageContent, VideoContent } from './media.js';
import { ConsentContent, ContactsContent, DateContent, RankingContent, ScaleContent, SwipeContent, TextInputContent } from './questions.js';

/**
 * Type-specific content of a block (P1.8), drawn under its text layer and nested blocks. Text (B-01),
 * shape (B-06), button (B-18), container (B-21) and choice questions (B-11, B-12) have none of their own:
 * their content is the text layer and the nested blocks — options are blocks (see `BlockView`).
 */
export function blockContent(block: Block, css: BlockCss, instanceId: string): ReactNode {
  switch (block.type) {
    case 'image':
      return <ImageContent block={block} css={css} />;
    case 'gif':
    case 'video':
      return <VideoContent block={block} css={css} instanceId={instanceId} />;
    case 'audio':
      return <AudioContent block={block} css={css} instanceId={instanceId} />;
    case 'animation':
      return <AnimationContent block={block} css={css} instanceId={instanceId} />;
    case 'timer':
      return <TimerContent block={block} css={css} instanceId={instanceId} />;
    case 'progress':
      return <ProgressContent block={block} css={css} />;
    case 'value':
      return <ValueContent block={block} css={css} />;
    case 'zone':
      return <ZoneContent block={block} />;
    case 'textInput':
      return <TextInputContent block={block} css={css} />;
    case 'scale':
      return <ScaleContent block={block} css={css} />;
    case 'swipe':
      return <SwipeContent block={block} css={css} />;
    case 'ranking':
      return <RankingContent block={block} css={css} />;
    case 'date':
      return <DateContent block={block} css={css} />;
    case 'contacts':
      return <ContactsContent block={block} css={css} />;
    case 'consent':
      return <ConsentContent block={block} css={css} />;
    case 'text':
    case 'shape':
    case 'button':
    case 'container':
    case 'singleChoice':
    case 'multiChoice':
      return null;
  }
}
