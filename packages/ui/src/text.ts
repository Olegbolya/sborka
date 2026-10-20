/** Joins truthy class names. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Russian plural form: pluralRu(5, ['сборка', 'сборки', 'сборок']) → 'сборок'.
 * Forms: [one (1, 21…), few (2–4, 22–24…), many (0, 5–20, 25…)]. Fractions use the «few» form.
 */
export function pluralRu(n: number, forms: readonly [string, string, string]): string {
  if (!Number.isInteger(n)) return forms[1];
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** «37 из 50» — limit counters in the cabinet (D-03). */
export function formatLimit(used: number, limit: number | null): string {
  const fmt = new Intl.NumberFormat('ru-RU');
  return limit === null ? `${fmt.format(used)} (без ограничения)` : `${fmt.format(used)} из ${fmt.format(limit)}`;
}
