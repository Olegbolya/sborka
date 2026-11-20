'use client';

import { type MediaOverlay, type Screen, type Transition } from '@blokum/schema';
import { type ComponentProps, type ReactNode } from 'react';
import { ScreenStage } from '../animation/ScreenStage.js';
import { ScreenView } from '../components/ScreenView.js';
import { PlayerScreen } from './PlayerScreen.js';

type PlayerScreenProps = ComponentProps<typeof PlayerScreen>;

/**
 * T-01…T-08, T-30 in the player: the screen of the passage changes with its transition — the one of the branch or
 * «перейти» action that led here, otherwise the screen's own «переход при входе». The coming screen is the live
 * one (scenarios, answers); the leaving one is only its picture while it goes away. A media insert (T-20, T-21) is
 * shown by the live screen itself (`entryOverlay`), so it is not passed to the stage.
 */
export function PlayerStage({ screenKey, transition, ...props }: PlayerScreenProps & { screenKey: number; transition?: Transition | null; entryOverlay?: MediaOverlay | null }): ReactNode {
  const step = transition && transition.kind !== 'media' ? transition : undefined;
  return (
    <ScreenStage screen={props.screen} {...(step ? { transition: step } : {})}>
      {(s: Screen) =>
        s.id === props.screen.id ? (
          <PlayerScreen key={`${s.id}:${screenKey}`} {...props} />
        ) : (
          <div className="bk-player-leaving" aria-hidden style={{ position: 'relative', pointerEvents: 'none' }}>
            <ScreenView screen={s} />
          </div>
        )
      }
    </ScreenStage>
  );
}
