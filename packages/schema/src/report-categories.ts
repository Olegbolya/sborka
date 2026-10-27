/** TS-11 · what a participant can complain about, in plain words (docs/06-TRUST-SAFETY.md §2, §4.1) and how urgent it is (§4.2). */
export type ReportPriority = 'P0' | 'P1' | 'P2';

export interface ReportCategory {
  code: string;
  label: string;
  priority: ReportPriority;
}

export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  { code: 'A1', label: 'Сексуальные материалы с детьми или их сексуализация', priority: 'P0' },
  { code: 'A2', label: 'Обман ради паролей, кодов из СМС или данных карт (имитация входа в банк, Госуслуги, соцсеть)', priority: 'P0' },
  { code: 'A3', label: 'Мошенничество: «вы выиграли — оплатите», фальшивые розыгрыши, пирамиды', priority: 'P1' },
  { code: 'A4', label: 'Призывы к терроризму, экстремизму, массовым беспорядкам', priority: 'P0' },
  { code: 'A5', label: 'Угрозы и призывы к насилию', priority: 'P0' },
  { code: 'A6', label: 'Вредоносные программы или ссылки на них', priority: 'P1' },
  { code: 'B1', label: 'Наркотики: продажа, пропаганда, способы изготовления', priority: 'P1' },
  { code: 'B2', label: 'Способы самоубийства и призывы к нему', priority: 'P1' },
  { code: 'B3', label: 'Азартные игры со ставками, нелегальные казино и букмекеры', priority: 'P1' },
  { code: 'B4', label: 'Порнография и откровенный сексуальный контент', priority: 'P1' },
  { code: 'B5', label: 'Чужие персональные данные, травля, интимные изображения без согласия', priority: 'P1' },
  { code: 'B6', label: 'Нарушение авторских прав', priority: 'P2' },
  { code: 'B7', label: 'Выдаёт себя за другого человека или организацию', priority: 'P2' },
  { code: 'B8', label: 'Реклама без пометки «Реклама»', priority: 'P2' },
  { code: 'B10', label: 'Спам', priority: 'P2' },
  { code: 'C', label: 'Другое', priority: 'P2' },
] as const;

/** Hours the moderators have to look at a complaint of each priority (§4.2). */
export const REPORT_SLA_HOURS: Record<ReportPriority, number> = { P0: 1, P1: 24, P2: 72 };

export const findReportCategory = (code: string): ReportCategory | undefined => REPORT_CATEGORIES.find((c) => c.code === code);
