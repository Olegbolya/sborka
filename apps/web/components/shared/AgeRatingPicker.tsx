'use client';

/** P8.7 (PL-09) · the five age categories as buttons: the same picker in the publish window of the editor and on the page «Ответы и доступ». */
export const AGE_CHOICES: Array<{ value: 0 | 6 | 12 | 16 | 18; label: string; hint: string }> = [
  { value: 0, label: '0+', hint: 'для всех' },
  { value: 6, label: '6+', hint: 'младшие школьники' },
  { value: 12, label: '12+', hint: 'подростки' },
  { value: 16, label: '16+', hint: 'старшие подростки' },
  { value: 18, label: '18+', hint: 'только для взрослых; спросим «Вам есть 18 лет?»' },
];

const chip = (on: boolean) =>
  ({
    padding: '8px 14px',
    borderRadius: 10,
    border: `1px solid ${on ? 'var(--accent, #e4572e)' : '#d6d2ca'}`,
    background: on ? 'var(--accent, #e4572e)' : '#fff',
    color: on ? '#fff' : 'inherit',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  }) as const;

export function AgeRatingPicker({ value, disabled, onPick }: { value: number | null | undefined; disabled?: boolean; onPick: (rating: 0 | 6 | 12 | 16 | 18) => void }) {
  const chosen = AGE_CHOICES.find((c) => c.value === value);
  return (
    <div data-testid="age-rating-picker">
      <div role="radiogroup" aria-label="Выбор возрастной категории" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {AGE_CHOICES.map((c) => (
          <button key={c.value} type="button" role="radio" aria-checked={value === c.value} disabled={disabled} style={{ ...chip(value === c.value), opacity: disabled ? 0.6 : 1 }} onClick={() => onPick(c.value)}>
            {c.label}
          </button>
        ))}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--muted, #6b6760)' }}>
        {chosen ? `${chosen.label} — ${chosen.hint}.` : 'Выберите, для кого сборка: знак виден участнику внизу экрана.'}
      </p>
    </div>
  );
}
