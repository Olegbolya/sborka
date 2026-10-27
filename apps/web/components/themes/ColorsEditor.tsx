'use client';
import { type ThemeTokens, THEME_COLOR_ROLES, ColorKey, HexColor } from '@blokum/schema';
import { useState } from 'react';
import { setThemeTokens } from '../../lib/editor/commands';
import { ROLE_TITLES } from '../editor/controls';
import { useEditor } from '../editor/context';

const HEX6 = /^#[0-9A-Fa-f]{6}$/;

/** A colour as a picker and as HEX text; what is typed stays on screen until it is a colour (then it is saved). */
function HexRow({ label, value, onChange, onRemove }: { label: string; value: string; onChange: (hex: string) => void; onRemove?: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  return (
    <div className="ed-colorrow" data-color={label}>
      <input type="color" aria-label={`${label}: выбор цвета`} value={HEX6.test(value) ? value.slice(0, 7) : '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      <input
        type="text"
        aria-label={`${label}: HEX`}
        value={shown}
        maxLength={9}
        spellCheck={false}
        onChange={(e) => {
          setDraft(e.target.value);
          if (HexColor.safeParse(e.target.value).success) onChange(e.target.value.toUpperCase());
        }}
        onBlur={() => setDraft(null)}
      />
      <span style={{ minWidth: 0, flex: 1 }}>{label}</span>
      {onRemove && (
        <button type="button" className="ed-btn small danger" aria-label={`Убрать цвет «${label}»`} onClick={onRemove}>
          Убрать
        </button>
      )}
    </div>
  );
}

/** TH-01 · the palette: the eight colours every theme has and any number of own ones. */
export function ColorsEditor() {
  const apply = useEditor((s) => s.apply);
  const colors = useEditor((s) => s.doc.theme.tokens.colors);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const own = Object.keys(colors).filter((k) => !(THEME_COLOR_ROLES as readonly string[]).includes(k));
  const set = (key: string, hex: string) => apply(setThemeTokens((t: ThemeTokens) => ({ ...t, colors: { ...t.colors, [key]: hex } })), { label: 'Цвет темы', mergeKey: `color:${key}` });

  const add = () => {
    const key = name.trim();
    if (!ColorKey.safeParse(key).success) return setProblem('Имя цвета — латиница, цифры, «_» или «-».');
    if (key in colors) return setProblem('Цвет с таким именем уже есть.');
    setProblem(null);
    setName('');
    apply(setThemeTokens((t) => ({ ...t, colors: { ...t.colors, [key]: '#888888' } })), { label: 'Новый цвет темы' });
  };

  return (
    <div data-testid="colors-editor">
      {THEME_COLOR_ROLES.map((role) => (
        <HexRow key={role} label={ROLE_TITLES[role] ?? role} value={colors[role] ?? '#000000'} onChange={(hex) => set(role, hex)} />
      ))}
      <h3 className="ed-addgroup">Свои цвета</h3>
      {own.length === 0 && <p className="ed-hint">Своих цветов пока нет.</p>}
      {own.map((key) => (
        <HexRow
          key={key}
          label={key}
          value={colors[key]!}
          onChange={(hex) => set(key, hex)}
          onRemove={() => apply(setThemeTokens((t) => ({ ...t, colors: Object.fromEntries(Object.entries(t.colors).filter(([k]) => k !== key)) })), { label: 'Убрать цвет темы' })}
        />
      ))}
      <div className="ed-colorrow">
        <input type="text" aria-label="Имя нового цвета" placeholder="Например, hero_1" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="ed-btn small" disabled={name.trim() === ''} onClick={add}>
          Добавить цвет
        </button>
      </div>
      {problem && (
        <p className="ed-hint" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
