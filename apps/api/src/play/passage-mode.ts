/** D-07 · how often the creator hears about passages of a project. */
export const PASSAGE_MODES = ['instant', 'hourly', 'daily', 'off'] as const;
export type PassageMode = (typeof PASSAGE_MODES)[number];

export const isPassageMode = (v: unknown): v is PassageMode => typeof v === 'string' && (PASSAGE_MODES as readonly string[]).includes(v);

/** What the plan allows (04-TARIFFS «Уведомления»): «Старт» — a digest once a day or silence, the paid plans — every mode. */
export function allowedPassageModes(level: 'daily' | 'instant' | 'instant_plus'): readonly PassageMode[] {
  return level === 'daily' ? ['daily', 'off'] : PASSAGE_MODES;
}

/** What is in force: the creator's choice if the plan allows it, otherwise the plan's own (a digest or at once). */
export function effectivePassageMode(allowed: readonly PassageMode[], settings: unknown): PassageMode {
  const chosen = ((settings as { notifications?: { passage?: unknown } } | null)?.notifications ?? {}).passage;
  if (isPassageMode(chosen) && allowed.includes(chosen)) return chosen;
  return allowed.includes('instant') ? 'instant' : 'daily';
}
