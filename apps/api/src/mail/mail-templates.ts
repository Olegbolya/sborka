/**
 * P10.6 · Letter templates. All strings are in Russian (N-05). Each kind defines the subject,
 * a plain-text body and an HTML body with the same wording, plus a list of required variables
 * for the renderer to validate. Marketing kinds carry `marketing: true` so the renderer adds
 * the «отписаться» link at the bottom (D-07 + 05-LEGAL §2.3).
 *
 * Variables use `{{name}}` placeholders — any unknown variable in a template or any required
 * variable missing at render time is an error, so a bad template never silently sends
 * «Здравствуйте, {{displayName}}!» to a user.
 */

export type MailKind =
  // Account
  | 'account.email-verify'
  | 'account.email-changed'
  | 'account.deletion-scheduled'
  | 'account.deletion-cancelled'
  // Moderation (AD-02/AD-03/AD-04)
  | 'moderation.content-removed'
  | 'moderation.appeal-accepted'
  | 'moderation.appeal-rejected'
  // Payments (ADR-016, P7)
  | 'payment.received'
  | 'payment.failed'
  | 'payment.subscription-renewed'
  | 'payment.subscription-expiring-soon'
  | 'payment.refunded'
  // Reminders (D-07)
  | 'reminder.incomplete-project'
  | 'reminder.first-passage'
  // Marketing (with mandatory unsubscribe link)
  | 'marketing.feature-announcement'
  | 'marketing.tips';

export interface MailTemplate {
  readonly kind: MailKind;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly variables: ReadonlyArray<string>;
  readonly marketing: boolean;
}

/** Internal: builds a template record and derives `variables` + `marketing` automatically. */
function tpl(kind: MailKind, subject: string, text: string, html: string): MailTemplate {
  const vars = new Set<string>();
  const re = /\{\{(\w+)\}\}/g;
  for (const field of [subject, text, html]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(field)) !== null) vars.add(m[1]!);
  }
  return {
    kind,
    subject,
    text,
    html,
    variables: [...vars].sort(),
    marketing: kind.startsWith('marketing.'),
  };
}

/**
 * Full catalogue of letter templates. The administrator sees the current wording in
 * `apps/web/app/admin/mail/page.tsx` and the user receives this exact text with
 * `{{variables}}` replaced by `MailTemplatesService.render`.
 */
export const MAIL_TEMPLATES: Readonly<Record<MailKind, MailTemplate>> = {
  'account.email-verify': tpl(
    'account.email-verify',
    'Подтвердите почту для «Блоккера»',
    [
      'Здравствуйте, {{displayName}}!',
      '',
      'Чтобы подтвердить почту, перейдите по ссылке:',
      '{{verifyUrl}}',
      '',
      'Ссылка действует 1 час. Если вы не привязывали эту почту к аккаунту «Блоккера», просто проигнорируйте письмо.',
    ].join('\n'),
    [
      '<p>Здравствуйте, {{displayName}}!</p>',
      '<p>Чтобы подтвердить почту, нажмите кнопку:</p>',
      '<p><a href="{{verifyUrl}}">Подтвердить почту</a></p>',
      '<p>Ссылка действует 1 час. Если вы не привязывали эту почту к аккаунту «Блоккера», просто проигнорируйте письмо.</p>',
    ].join(''),
  ),

  'account.email-changed': tpl(
    'account.email-changed',
    'Почта аккаунта «Блоккер» изменена',
    [
      'Здравствуйте, {{displayName}}!',
      '',
      'Почта на вашем аккаунте «Блоккер» теперь — {{newEmail}}.',
      'Если это сделали не вы, сразу напишите нам: {{supportEmail}}.',
    ].join('\n'),
    [
      '<p>Здравствуйте, {{displayName}}!</p>',
      '<p>Почта на вашем аккаунте «Блоккер» теперь — <strong>{{newEmail}}</strong>.</p>',
      '<p>Если это сделали не вы, сразу напишите нам: <a href="mailto:{{supportEmail}}">{{supportEmail}}</a>.</p>',
    ].join(''),
  ),

  'account.deletion-scheduled': tpl(
    'account.deletion-scheduled',
    'Удаление аккаунта «Блоккер» запланировано',
    [
      'Здравствуйте, {{displayName}}!',
      '',
      'Мы приняли запрос на удаление. Через 30 дней аккаунт и все сборки будут удалены без возможности восстановления.',
      'Передумали? Войдите и нажмите «Восстановить аккаунт»: {{restoreUrl}}',
    ].join('\n'),
    [
      '<p>Здравствуйте, {{displayName}}!</p>',
      '<p>Мы приняли запрос на удаление. Через 30 дней аккаунт и все сборки будут удалены без возможности восстановления.</p>',
      '<p>Передумали? <a href="{{restoreUrl}}">Восстановить аккаунт</a>.</p>',
    ].join(''),
  ),

  'account.deletion-cancelled': tpl(
    'account.deletion-cancelled',
    'Удаление аккаунта «Блоккер» отменено',
    [
      'Здравствуйте, {{displayName}}!',
      '',
      'Удаление отменено — аккаунт и сборки на месте. Если это не вы, напишите нам: {{supportEmail}}.',
    ].join('\n'),
    [
      '<p>Здравствуйте, {{displayName}}!</p>',
      '<p>Удаление отменено — аккаунт и сборки на месте. Если это не вы, напишите нам: <a href="mailto:{{supportEmail}}">{{supportEmail}}</a>.</p>',
    ].join(''),
  ),

  'moderation.content-removed': tpl(
    'moderation.content-removed',
    'Содержимое снято с публикации — {{projectTitle}}',
    [
      'Здравствуйте, {{displayName}}!',
      '',
      'Модератор снял с публикации «{{projectTitle}}». Причина: {{reason}}',
      'Если считаете решение неверным, подайте обжалование: {{appealUrl}}',
    ].join('\n'),
    [
      '<p>Здравствуйте, {{displayName}}!</p>',
      '<p>Модератор снял с публикации «<strong>{{projectTitle}}</strong>». Причина: {{reason}}</p>',
      '<p><a href="{{appealUrl}}">Подать обжалование</a>.</p>',
    ].join(''),
  ),

  'moderation.appeal-accepted': tpl(
    'moderation.appeal-accepted',
    'Обжалование принято — {{projectTitle}}',
    [
      'Здравствуйте, {{displayName}}!',
      '',
      'Обжалование принято — сборка «{{projectTitle}}» снова доступна.',
    ].join('\n'),
    [
      '<p>Здравствуйте, {{displayName}}!</p>',
      '<p>Обжалование принято — сборка «<strong>{{projectTitle}}</strong>» снова доступна.</p>',
    ].join(''),
  ),

  'moderation.appeal-rejected': tpl(
    'moderation.appeal-rejected',
    'Обжалование отклонено — {{projectTitle}}',
    [
      'Здравствуйте, {{displayName}}!',
      '',
      'Обжалование отклонено. Причина: {{reason}}',
      'Можно подать повторное обжалование через 7 дней или удалить сборку: {{projectUrl}}',
    ].join('\n'),
    [
      '<p>Здравствуйте, {{displayName}}!</p>',
      '<p>Обжалование отклонено. Причина: {{reason}}</p>',
      '<p><a href="{{projectUrl}}">Открыть сборку</a>.</p>',
    ].join(''),
  ),

  'payment.received': tpl(
    'payment.received',
    'Оплата получена — тариф «{{planName}}»',
    [
      'Здравствуйте, {{displayName}}!',
      '',
      'Оплата {{amount}} ₽ получена. Тариф «{{planName}}» действует до {{expiresAt}}.',
      'Чек: {{receiptUrl}}',
    ].join('\n'),
    [
      '<p>Здравствуйте, {{displayName}}!</p>',
      '<p>Оплата <strong>{{amount}} ₽</strong> получена. Тариф «<strong>{{planName}}</strong>» действует до {{expiresAt}}.</p>',
      '<p><a href="{{receiptUrl}}">Открыть чек</a>.</p>',
    ].join(''),
  ),

  'payment.failed': tpl(
    'payment.failed',
    'Оплата не прошла — тариф «{{planName}}»',
    [
      'Здравствуйте, {{displayName}}!',
      '',
      'Оплата тарифа «{{planName}}» не прошла. Причина: {{reason}}',
      'Попробуйте снова: {{retryUrl}}',
    ].join('\n'),
    [
      '<p>Здравствуйте, {{displayName}}!</p>',
      '<p>Оплата тарифа «<strong>{{planName}}</strong>» не прошла. Причина: {{reason}}</p>',
      '<p><a href="{{retryUrl}}">Попробовать снова</a>.</p>',
    ].join(''),
  ),

  'payment.subscription-renewed': tpl(
    'payment.subscription-renewed',
    'Подписка «{{planName}}» продлена',
    [
      'Здравствуйте, {{displayName}}!',
      '',
      'Подписка «{{planName}}» продлена до {{expiresAt}}. С вашей карты списано {{amount}} ₽.',
      'Чек: {{receiptUrl}}',
    ].join('\n'),
    [
      '<p>Здравствуйте, {{displayName}}!</p>',
      '<p>Подписка «<strong>{{planName}}</strong>» продлена до {{expiresAt}}. С вашей карты списано <strong>{{amount}} ₽</strong>.</p>',
      '<p><a href="{{receiptUrl}}">Открыть чек</a>.</p>',
    ].join(''),
  ),

  'payment.subscription-expiring-soon': tpl(
    'payment.subscription-expiring-soon',
    'Подписка «{{planName}}» заканчивается {{expiresAt}}',
    [
      'Здравствуйте, {{displayName}}!',
      '',
      'Подписка «{{planName}}» закончится {{expiresAt}} ({{daysLeft}} дней). Чтобы она продолжала работать, продлите её: {{renewUrl}}',
    ].join('\n'),
    [
      '<p>Здравствуйте, {{displayName}}!</p>',
      '<p>Подписка «<strong>{{planName}}</strong>» закончится {{expiresAt}} ({{daysLeft}} дней).</p>',
      '<p><a href="{{renewUrl}}">Продлить</a>.</p>',
    ].join(''),
  ),

  'payment.refunded': tpl(
    'payment.refunded',
    'Возврат проведён — {{amount}} ₽',
    [
      'Здравствуйте, {{displayName}}!',
      '',
      'Возврат {{amount}} ₽ по заказу {{orderId}} проведён. Деньги вернутся на карту в течение 10 дней.',
    ].join('\n'),
    [
      '<p>Здравствуйте, {{displayName}}!</p>',
      '<p>Возврат <strong>{{amount}} ₽</strong> по заказу {{orderId}} проведён. Деньги вернутся на карту в течение 10 дней.</p>',
    ].join(''),
  ),

  'reminder.incomplete-project': tpl(
    'reminder.incomplete-project',
    'Сборка «{{projectTitle}}» ждёт вас',
    [
      'Здравствуйте, {{displayName}}!',
      '',
      'Вы оставили сборку «{{projectTitle}}» на этапе {{stageName}}. Пара минут — и можно опубликовать: {{editUrl}}',
    ].join('\n'),
    [
      '<p>Здравствуйте, {{displayName}}!</p>',
      '<p>Вы оставили сборку «<strong>{{projectTitle}}</strong>» на этапе {{stageName}}. Пара минут — и можно опубликовать:</p>',
      '<p><a href="{{editUrl}}">Открыть редактор</a>.</p>',
    ].join(''),
  ),

  'reminder.first-passage': tpl(
    'reminder.first-passage',
    'Вашу сборку «{{projectTitle}}» прошли впервые',
    [
      'Здравствуйте, {{displayName}}!',
      '',
      'Вашу сборку «{{projectTitle}}» прошли впервые. Ответ уже в кабинете: {{answersUrl}}',
    ].join('\n'),
    [
      '<p>Здравствуйте, {{displayName}}!</p>',
      '<p>Вашу сборку «<strong>{{projectTitle}}</strong>» прошли впервые.</p>',
      '<p><a href="{{answersUrl}}">Посмотреть ответ</a>.</p>',
    ].join(''),
  ),

  'marketing.feature-announcement': tpl(
    'marketing.feature-announcement',
    '{{featureTitle}} — новая возможность «Блоккера»',
    [
      'Здравствуйте, {{displayName}}!',
      '',
      '{{featureSummary}}',
      '',
      'Подробнее: {{featureUrl}}',
    ].join('\n'),
    [
      '<p>Здравствуйте, {{displayName}}!</p>',
      '<p>{{featureSummary}}</p>',
      '<p><a href="{{featureUrl}}">Подробнее</a>.</p>',
    ].join(''),
  ),

  'marketing.tips': tpl(
    'marketing.tips',
    'Как собрать «{{exampleTitle}}» за десять минут',
    [
      'Здравствуйте, {{displayName}}!',
      '',
      '{{tipBody}}',
      '',
      'Пример в редакторе: {{exampleUrl}}',
    ].join('\n'),
    [
      '<p>Здравствуйте, {{displayName}}!</p>',
      '<p>{{tipBody}}</p>',
      '<p><a href="{{exampleUrl}}">Открыть пример</a>.</p>',
    ].join(''),
  ),
};

export const MAIL_KINDS: ReadonlyArray<MailKind> = Object.keys(MAIL_TEMPLATES) as MailKind[];
