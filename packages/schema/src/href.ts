/** The link has an allowed kind (PL-22): web, mail or phone. Plain function: the player checks links without the schema parser. */
export function isSafeHref(value: string): boolean {
  if (value.length > 2000) return false;
  try {
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
