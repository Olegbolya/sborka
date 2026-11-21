/** D-07 · PL-06: the message when the creator's own limit of a project is reached (the project then shows «Сборка закрыта»). */
export interface CreatorLimitNotice {
  kind: 'creator-limit';
  title: string;
  body: string;
}

/**
 * `value` is the counter after this start or completion; the message is due only when it equals the limit — the counter grows by
 * one under a lock, so that happens once (raising the limit later and reaching it again is a new message, and it should be).
 */
export function creatorLimitNotice(
  kind: 'starts' | 'completions',
  value: number,
  settings: { maxStarts?: number | null; maxCompletions?: number | null },
  projectTitle: string,
): CreatorLimitNotice | null {
  const limit = kind === 'starts' ? settings.maxStarts : settings.maxCompletions;
  if (!limit || limit < 1 || value !== limit) return null;
  const name = `«${projectTitle.slice(0, 80)}»`;
  const what = kind === 'starts' ? `${limit} запусков` : `${limit} завершённых прохождений`;
  return {
    kind: 'creator-limit',
    title: `Сборка ${name} закрылась: набран ваш лимит`,
    body: `Сборка ${name} набрала ${what} — столько вы указали в «Настройках доступа». Новые участники видят текст закрытой сборки${kind === 'starts' ? '' : ', начатые прохождения можно закончить'}. Чтобы принимать участников дальше, увеличьте или уберите лимит в «Настройках доступа».`,
  };
}
