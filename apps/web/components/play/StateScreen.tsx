import { Artboard } from '@blokum/renderer';
import { type ThemeTokens } from '@blokum/schema';
import { type ReactNode } from 'react';
import './player.css';

/** §10.3 · «Откроется …», «Сборка закрыта»… in the theme of the project (colours and the background of the theme). */
export function StateScreen({ theme, title, text, children }: { theme: ThemeTokens; title: string; text: string; children?: ReactNode }) {
  return (
    <Artboard mode="player" tokens={theme}>
      <div className="pl-state" data-testid="play-state" style={{ color: theme.colors.text }} role="status">
        <h1 style={{ margin: 0, fontSize: 28 }}>{title}</h1>
        <p style={{ margin: 0 }}>{text}</p>
        {children}
      </div>
    </Artboard>
  );
}
