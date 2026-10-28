/*
 * AD-03, docs/06-TRUST-SAFETY.md §5 · what a moderator can do and the reasons (templates) to give for it. Plain data and
 * no schema parser, so the admin pages and the API read the same lists.
 */
export const MODERATION_ACTIONS = ['WARN', 'UNPUBLISH', 'BLOCK_PROJECT', 'BLOCK_MEDIA', 'BLOCK_USER', 'LEGAL_HOLD', 'RELEASE_HOLD', 'RESTORE'] as const;
export type ModerationActionKind = (typeof MODERATION_ACTIONS)[number];

export const MODERATION_TARGETS = ['PROJECT', 'MEDIA', 'USER'] as const;
export type ModerationTargetKind = (typeof MODERATION_TARGETS)[number];

/** Which actions fit which target. */
export const ACTIONS_BY_TARGET: Record<ModerationTargetKind, readonly ModerationActionKind[]> = {
  PROJECT: ['WARN', 'UNPUBLISH', 'BLOCK_PROJECT', 'LEGAL_HOLD', 'RELEASE_HOLD', 'RESTORE'],
  MEDIA: ['BLOCK_MEDIA', 'RESTORE'],
  USER: ['WARN', 'BLOCK_USER', 'LEGAL_HOLD', 'RELEASE_HOLD', 'RESTORE'],
};

export const MODERATION_ACTION_LABELS: Record<ModerationActionKind, string> = {
  WARN: 'Предупредить',
  UNPUBLISH: 'Снять с публикации',
  BLOCK_PROJECT: 'Заблокировать сборку',
  BLOCK_MEDIA: 'Заблокировать файл',
  BLOCK_USER: 'Заблокировать аккаунт',
  LEGAL_HOLD: 'Юридическое хранение',
  RELEASE_HOLD: 'Снять юридическое хранение',
  RESTORE: 'Восстановить',
};

export interface ModerationReason {
  code: string;
  /** Short name in the select. */
  label: string;
  /** The text the creator gets; the moderator's comment is added under it. */
  message: string;
}

/** Reason templates (AD-03). The code is kept in `moderation_actions.reason_code`. */
export const MODERATION_REASONS: readonly ModerationReason[] = [
  { code: 'A1', label: 'A1 · Сексуальные материалы с детьми', message: 'Материал нарушает правила допустимого контента (категория A1).' },
  { code: 'A2', label: 'A2 · Обман ради паролей и данных карт', message: 'Сборка выманивает пароли, коды из СМС или данные карт (категория A2).' },
  { code: 'A3', label: 'A3 · Мошенничество', message: 'Сборка похожа на мошенничество: фальшивые розыгрыши, требование оплаты за «выигрыш» (категория A3).' },
  { code: 'A4', label: 'A4 · Экстремизм и терроризм', message: 'Материал содержит призывы, запрещённые законом (категория A4).' },
  { code: 'A5', label: 'A5 · Угрозы и насилие', message: 'Материал содержит угрозы или призывы к насилию (категория A5).' },
  { code: 'A6', label: 'A6 · Вредоносные программы', message: 'Сборка ведёт на вредоносные программы или содержит их (категория A6).' },
  { code: 'B1', label: 'B1 · Наркотики', message: 'Материал пропагандирует наркотики или их продажу (категория B1).' },
  { code: 'B2', label: 'B2 · Самоубийства', message: 'Материал содержит способы самоубийства или призывы к нему (категория B2).' },
  { code: 'B3', label: 'B3 · Азартные игры', message: 'Сборка продвигает азартные игры со ставками (категория B3).' },
  { code: 'B4', label: 'B4 · Откровенный контент', message: 'Сборка содержит откровенный сексуальный контент (категория B4).' },
  { code: 'B5', label: 'B5 · Чужие данные и травля', message: 'В сборке чужие персональные данные, травля или интимные изображения без согласия (категория B5).' },
  { code: 'B6', label: 'B6 · Авторские права', message: 'Сборка использует чужие материалы без разрешения правообладателя (категория B6).' },
  { code: 'B7', label: 'B7 · Выдаёт себя за другого', message: 'Сборка выдаёт себя за другого человека или организацию (категория B7).' },
  { code: 'B8', label: 'B8 · Реклама без пометки', message: 'Реклама в сборке не помечена (категория B8): добавьте пометку «Реклама» и данные рекламодателя.' },
  { code: 'B10', label: 'B10 · Спам', message: 'Сборка похожа на спам (категория B10).' },
  { code: 'C', label: 'C · Другое', message: 'Сборка нарушает правила сервиса.' },
  { code: 'AUTO_P0', label: 'Автоматически · тяжёлая жалоба', message: 'Сборка временно снята с публикации до проверки модератором: на неё поступила жалоба о тяжёлом нарушении.' },
  { code: 'APPEAL_GRANTED', label: 'Обжалование удовлетворено', message: 'Мы пересмотрели решение и восстановили доступ.' },
  { code: 'MISTAKE', label: 'Жалоба не подтвердилась', message: 'Проверка не нашла нарушения, доступ восстановлен.' },
  { code: 'OTHER', label: 'Другая причина', message: 'Решение принято модератором.' },
];

export const findModerationReason = (code: string): ModerationReason | undefined => MODERATION_REASONS.find((r) => r.code === code);

/** After this many hours the moderator who made a decision may review the appeal against it themselves (§5). */
export const APPEAL_SELF_REVIEW_HOURS = 24;

/** Hours the moderators have to answer a copyright holder's notice (§4.3, 149-ФЗ ст. 15.7). */
export const COPYRIGHT_CLAIM_HOURS = 24;

/** AD-07 · emergency switches (§7): the key and the words shown in the admin. */
export const FEATURE_FLAGS = [
  { key: 'REGISTRATION_ENABLED', label: 'Регистрация новых пользователей' },
  { key: 'UPLOADS_ENABLED', label: 'Загрузка файлов' },
  { key: 'PUBLISHING_ENABLED', label: 'Публикация сборок' },
  { key: 'PLAYER_ENABLED', label: 'Прохождение сборок (плеер)' },
  { key: 'EXTERNAL_LINKS_ENABLED', label: 'Переходы по внешним ссылкам' },
  { key: 'SMS_ENABLED', label: 'Отправка СМС' },
] as const;
export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number]['key'];
