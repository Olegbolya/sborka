'use client';
import { type CSSProperties, useEffect, useState } from 'react';
import { type ThemeChoice, applyTheme, readTheme } from '../../lib/theme';

const CHOICES: Array<[ThemeChoice, string]> = [
  ['system', 'Как в системе'],
  ['light', 'Светлое'],
  ['dark', 'Тёмное'],
];

/** Оформление сайта и редактора: светлое, тёмное или как в системе; меняется сразу, без перезагрузки. */
export function ThemeSetting({ titleStyle, textStyle }: { titleStyle: CSSProperties; textStyle: CSSProperties }) {
  const [choice, setChoice] = useState<ThemeChoice>('system');
  useEffect(() => setChoice(readTheme()), []);
  return (
    <section style={{ marginBottom: 32 }} data-testid="theme-setting">
      <p style={titleStyle} id="theme-title">
        Оформление
      </p>
      <div role="radiogroup" aria-labelledby="theme-title" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {CHOICES.map(([value, label]) => {
          const on = choice === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={on}
              data-theme-choice={value}
              onClick={() => {
                applyTheme(value);
                setChoice(value);
              }}
              style={{ padding: '10px 16px', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer', border: `2px solid ${on ? 'var(--accent)' : 'var(--muted)'}`, background: on ? 'var(--accent)' : 'transparent', color: on ? '#fff' : 'var(--fg)' }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <p style={{ ...textStyle, marginTop: 8 }}>Цвета сайта, кабинета и редактора. Сборки участники видят в теме, которую выбрал автор.</p>
    </section>
  );
}
