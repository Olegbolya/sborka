import { type ReportPriority } from '@blokum/schema';

/** AD-03 · the countdown of a term: «осталось 45 мин» or «просрочено на 3 ч». */
export function remainingText(ms: number): string {
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const span = days >= 2 ? `${days} дн.` : hours >= 1 ? `${hours} ч ${minutes % 60} мин` : `${Math.max(minutes, 1)} мин`;
  return ms >= 0 ? `осталось ${span}` : `просрочено на ${span}`;
}

export const PRIORITY_COLOR: Record<ReportPriority, string> = { P0: '#dc2626', P1: '#d97706', P2: '#6b665d' };

export const PRIORITY_NOTE: Record<ReportPriority, string> = { P0: 'срочно', P1: 'в течение суток', P2: 'в течение 3 суток' };

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function rubles(kop: number): string {
  return `${(kop / 100).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₽`;
}

export const PROJECT_STATUS: Record<string, string> = { DRAFT: 'Черновик', PUBLISHED: 'Опубликована', CLOSED: 'Закрыта', BLOCKED: 'Заблокирована', DELETED: 'Удалена' };
export const USER_STATUS: Record<string, string> = { ACTIVE: 'Активен', BLOCKED: 'Заблокирован', DELETED: 'Удалён' };
export const ROLE_LABEL: Record<string, string> = { USER: 'Пользователь', MODERATOR: 'Модератор', ADMIN: 'Администратор' };
export const REPORT_STATUS: Record<string, string> = { NEW: 'Новая', IN_REVIEW: 'В работе', RESOLVED: 'Решена', REJECTED: 'Отклонена' };
export const CLAIM_STATUS: Record<string, string> = { NEW: 'Новое', CLARIFY_REQUESTED: 'Запрошено уточнение', REMOVED: 'Материал снят', REJECTED_WITH_PROOF: 'Отклонено с доказательствами' };
export const CASE_STATUS: Record<string, string> = { NEW: 'Новое', IN_PROGRESS: 'В работе', CLOSED: 'Закрыто' };
export const ORDER_STATUS: Record<string, string> = { PENDING: 'Ожидает оплаты', PAID: 'Оплачен', CANCELED: 'Отменён', REFUNDED: 'Возврат' };
export const APPEAL_STATUS: Record<string, string> = { NEW: 'Ждёт решения', GRANTED: 'Удовлетворено', DENIED: 'Отклонено' };
export const PROVIDER_LABEL: Record<string, string> = { VK: 'VK ID', YANDEX: 'Яндекс ID', PHONE: 'Телефон' };
