import { apiFetch } from '../api-client';

/** One plan as `GET /plans` gives it (the same limits the server enforces). */
export interface PlanView {
  code: string;
  title: string;
  priceMonthRub: number | null;
  priceYearRub: number | null;
  priceOnceRub: number | null;
  limits: {
    publishedProjects: number | null;
    completionsPerMonth: number;
    completionsScope: 'account' | 'project';
    screensPerProject: number;
    rulesPerProject: number;
    behaviors: 'all' | string[];
    ownFonts: boolean;
    audio: boolean;
    watermark: boolean;
    customSlug: boolean;
    styledQr: boolean;
    accessPointsPerProject: number | null;
    accessControls: boolean;
    contactsCollection: boolean;
    storageBytes: number;
    maxVideoBytes: number;
    maxVideoSeconds: number;
    answersRetentionDays: number;
    exportFormats: string[];
    versionHistoryDays: number;
    ownBranding: boolean;
    allowIndexing: boolean;
    invoicePayment: boolean;
    supportHours: number | null;
    passDays?: number;
  };
}

const nf = new Intl.NumberFormat('ru-RU');
const num = (n: number) => nf.format(n).replace(/\u202f/g, '\u00a0');

/** «1 000» → «1 000», 4 → «4»: numbers of the page are written the Russian way, with a non-breaking space. */
export const formatNumber = num;

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function formatBytes(bytes: number): string {
  const gb = 1024 ** 3;
  if (bytes >= gb) return `${num(Math.round((bytes / gb) * 10) / 10)}\u00a0ГБ`;
  return `${num(Math.round(bytes / 1024 ** 2))}\u00a0МБ`;
}

export function formatDays(days: number): string {
  if (days % 365 === 0) {
    const y = days / 365;
    return `${y}\u00a0${plural(y, 'год', 'года', 'лет')}`;
  }
  return `${num(days)}\u00a0${plural(days, 'день', 'дня', 'дней')}`;
}

/** The price line of a plan: «0 ₽», «249 ₽ разово», «349 ₽ в месяц». */
export function priceLine(p: PlanView): { main: string; extra: string | null } {
  if (p.priceOnceRub !== null) return { main: `${num(p.priceOnceRub)}\u00a0₽`, extra: `разово, на одну сборку${p.limits.passDays ? ` на ${formatDays(p.limits.passDays)}` : ''}` };
  if (!p.priceMonthRub) return { main: '0\u00a0₽', extra: 'навсегда' };
  return { main: `${num(p.priceMonthRub)}\u00a0₽`, extra: `в месяц${p.priceYearRub ? `, или ${num(p.priceYearRub)}\u00a0₽ в год` : ''}` };
}

/** What a plan gives, in the words of a person (TARIFFS §2): the first lines are the limits that decide the choice. */
export function describePlan(p: PlanView): string[] {
  const l = p.limits;
  const out: string[] = [];
  out.push(
    l.publishedProjects === null
      ? 'Сборок одновременно — сколько нужно'
      : `${num(l.publishedProjects)}\u00a0${plural(l.publishedProjects, 'сборка', 'сборки', 'сборок')} одновременно`,
  );
  out.push(`${num(l.completionsPerMonth)}\u00a0${plural(l.completionsPerMonth, 'прохождение', 'прохождения', 'прохождений')} ${l.completionsScope === 'project' ? 'на сборку за срок пропуска' : 'в месяц'}`);
  out.push(`До\u00a0${num(l.screensPerProject)}\u00a0экранов и ${num(l.rulesPerProject)}\u00a0правил в сборке`);
  out.push(l.behaviors === 'all' ? 'Все поведения блоков' : 'Перетаскивание, переворот и убегание');
  out.push(l.watermark ? 'Водяной знак «Сделано в Блокуме»' : 'Без водяного знака');
  if (l.customSlug) out.push('Свой адрес ссылки и оформленный QR-код');
  if (l.ownFonts) out.push('Свои шрифты и звук');
  if (l.accessControls) out.push('Пароль, расписание, одна попытка с устройства');
  if (l.contactsCollection) out.push('Сбор контактов участников');
  out.push(`Хранилище ${formatBytes(l.storageBytes)}, видео до\u00a0${formatBytes(l.maxVideoBytes)}`);
  out.push(`Ответы хранятся ${formatDays(l.answersRetentionDays)}`);
  if (l.exportFormats.length) out.push(`Выгрузка ответов: ${l.exportFormats.map((f) => f.toUpperCase()).join(' и ')}`);
  if (l.versionHistoryDays) out.push(`История версий: ${formatDays(l.versionHistoryDays)}`);
  if (l.ownBranding) out.push('Свой логотип и картинка для ссылки');
  if (l.allowIndexing) out.push('Можно разрешить поиск по сборке');
  if (l.invoicePayment) out.push('Оплата по счёту для юрлиц');
  out.push(l.supportHours === null ? 'Поддержка: справка' : `Поддержка: ответ в течение ${l.supportHours}\u00a0${plural(l.supportHours, 'часа', 'часов', 'часов')}`);
  return out;
}

/** The plans for the pages; `null` — the server did not answer (the page says so instead of showing made-up prices). */
export async function loadPlans(requestId?: string | null): Promise<PlanView[] | null> {
  try {
    const res = await apiFetch('/api/v1/plans', { requestId: requestId ?? null });
    if (!res.ok) return null;
    const body = (await res.json()) as { plans?: PlanView[] };
    return Array.isArray(body.plans) ? body.plans : null;
  } catch {
    return null;
  }
}
